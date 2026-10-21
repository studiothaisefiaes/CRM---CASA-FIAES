import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, contacts } from "../db/schema";
import { parseBirthday } from "@/lib/birthday";
import { cpfDigits, isValidCpf } from "@/lib/cpf";
import { normalizePhone } from "./phone";
import { UserFacingError } from "./errors";
import { startConversation } from "./start-conversation";

/** O telefone já é de outro contato: a tela mostra a ficha que existe em vez de duplicar. */
export class DuplicatePhoneError extends UserFacingError {
  constructor(readonly existing: { id: string; name: string | null }) { super("Já existe uma cliente com esse telefone."); }
}

const PHONE_HINT = "Telefone inválido. Use DDD + número, ex.: 71 99999-9999";

/** O número e a forma dele com/sem o 9 da frente (cadastro antigo pode estar sem): os dois contam como o mesmo telefone. */
function samePhones(e164: string): string[] {
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (!m) return [e164];
  const [, ddd, n] = m;
  return n.length === 9 && n.startsWith("9") ? [e164, `+55${ddd}${n.slice(1)}`] : n.length === 8 ? [e164, `+55${ddd}9${n}`] : [e164];
}

export async function findContactByPhone(raw: string) {
  const phone = normalizePhone(raw);
  if (!phone) throw new UserFacingError(PHONE_HINT);
  const [c] = await db.select({ id: contacts.id, name: contacts.name, ignored: contacts.ignored }).from(contacts).where(inArray(contacts.phoneE164, samePhones(phone))).limit(1);
  return { phone, contact: c ?? null };
}

const clientSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da cliente.").max(120, "Nome muito longo."),
  phone: z.string().trim().min(1, "Informe o telefone."),
  email: z.string().trim().max(200).email("E-mail inválido.").optional().or(z.literal("")),
  birthday: z.string().trim().max(10).optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
});
export type NewClientInput = z.input<typeof clientSchema>;

/**
 * "Nova cliente" (Clientes): nome e telefone obrigatórios; e-mail e aniversário opcionais. Não abre conversa nem manda nada.
 * Telefone que já existe (inclusive com/sem o 9) é recusado com a ficha existente (`DuplicatePhoneError`).
 */
export async function createClient(raw: NewClientInput, userId: string): Promise<{ contactId: string }> {
  const input = clientSchema.parse(raw);
  const { phone, contact } = await findContactByPhone(input.phone);
  if (contact) throw new DuplicatePhoneError({ id: contact.id, name: contact.name });
  const cpf = cpfDigits(input.cpf);
  if (cpf && !isValidCpf(cpf)) throw new UserFacingError("CPF inválido.");
  let birth: { birthDay: number; birthMonth: number; birthYear: number | null } | null = null;
  if (input.birthday) {
    const b = parseBirthday(input.birthday);
    if (!b.ok) throw new UserFacingError(b.error);
    birth = { birthDay: b.day, birthMonth: b.month, birthYear: b.year };
  }
  const [c] = await db.insert(contacts).values({ name: input.name, phoneE164: phone, email: input.email || null, cpf: cpf || null, ...(birth ?? {}) })
    .onConflictDoNothing({ target: contacts.phoneE164 }).returning({ id: contacts.id });
  if (!c) { // cadastrado ao mesmo tempo por outra pessoa (ou pela mensagem que chegou)
    const [other] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.phoneE164, phone));
    throw new DuplicatePhoneError(other ?? { id: "", name: null });
  }
  await db.insert(auditLog).values({ userId, action: "cadastrou_cliente", entity: "contact", entityId: c.id, data: {} });
  return { contactId: c.id };
}

/**
 * "Nova conversa" (Atendimento): acha o contato pelo telefone (ou cadastra com o nome) e abre a conversa pronta para a Casa escrever.
 * NÃO envia nada. Já tem conversa aberta: leva a ela. "Não é cliente": recusa (quem decide voltar é a pessoa, na ficha).
 */
export async function startNewConversation(raw: { phone: string; name?: string | null }, userId: string): Promise<{ dealId: string; created: boolean; newContact: boolean }> {
  const name = raw.name?.trim().slice(0, 120) || null;
  const found = await findContactByPhone(raw.phone);
  let contactId = found.contact?.id ?? null;
  if (!contactId) {
    const [c] = await db.insert(contacts).values({ name, phoneE164: found.phone })
      .onConflictDoUpdate({ target: contacts.phoneE164, set: { phoneE164: found.phone } }).returning({ id: contacts.id });
    contactId = c.id;
  } else if (name && !found.contact!.name) {
    await db.update(contacts).set({ name }).where(eq(contacts.id, contactId));
  }
  const r = await startConversation(contactId, userId);
  return { ...r, newContact: !found.contact };
}
