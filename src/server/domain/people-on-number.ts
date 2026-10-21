import { randomUUID } from "node:crypto";
import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, contacts } from "../db/schema";
import { parseBirthday } from "@/lib/birthday";
import { cpfDigits, isValidCpf } from "@/lib/cpf";
import { nameTokens } from "@/lib/same-person";
import { PERSON_PHONE_PREFIX } from "@/lib/phone-client";
import { UserFacingError } from "./errors";

/**
 * Várias pessoas no mesmo número (17/10, caso Cati: mãe e filha usam o mesmo celular e as duas são clientes).
 * - O contato do WhatsApp (o número) continua sendo o TITULAR: a conversa, as mensagens e os envios são sempre dele.
 * - Cada pessoa a mais (filha, mãe, marido…) é um contato com ficha própria (nome, aniversário, CPF, dados, horários, pacotes, notas),
 *   ligado ao titular por `shares_phone_with`. O "telefone" dela é "pessoa:<uuid>": não é número de WhatsApp (a unicidade do telefone
 *   continua valendo para o WhatsApp) e `isHiddenNumber` o trata como número que não recebe mensagem.
 * - Tudo que fala com a cliente pelo WhatsApp (conversa, lembrete D-1, funil da agenda) usa o titular (`holderIdOf`), com o NOME da pessoa do horário.
 */

type Db = typeof db | Tx;
export type PersonOnNumber = { id: string; name: string | null; relation: string | null; isHolder: boolean };
export type PeopleOnNumber = { holderId: string; holderName: string | null; holderPhone: string; people: PersonOnNumber[] };

export const newPersonPhone = () => `${PERSON_PHONE_PREFIX}${randomUUID()}`;

/** O titular do número: o próprio contato, ou aquele com quem ele divide o número. */
export async function holderIdOf(contactId: string, tx: Db = db): Promise<string> {
  const [c] = await tx.select({ holder: sql<string>`coalesce(${contacts.sharesPhoneWith}, ${contacts.id})` }).from(contacts).where(eq(contacts.id, contactId));
  return c?.holder ?? contactId;
}

/** Todos os contatos do número (o titular primeiro). Sem ninguém a mais, só `[titular]`: quem chama se comporta como antes. */
export async function numberContactIds(contactId: string, tx: Db = db): Promise<string[]> {
  const holderId = await holderIdOf(contactId, tx);
  const rows = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.sharesPhoneWith, holderId)).orderBy(asc(contacts.createdAt));
  return [holderId, ...rows.map((r) => r.id)];
}

/** As pessoas do número de `contactId` (titular primeiro, depois as outras na ordem em que entraram). */
export async function peopleOnNumber(contactId: string, tx: Db = db): Promise<PeopleOnNumber | null> {
  const holderId = await holderIdOf(contactId, tx);
  const rows = await tx.select({ id: contacts.id, name: contacts.name, relation: contacts.phoneRelation, phone: contacts.phoneE164, holder: contacts.sharesPhoneWith })
    .from(contacts).where(or(eq(contacts.id, holderId), eq(contacts.sharesPhoneWith, holderId))).orderBy(asc(contacts.createdAt));
  const holder = rows.find((r) => r.id === holderId);
  if (!holder) return null;
  return {
    holderId, holderName: holder.name, holderPhone: holder.phone,
    people: [holder, ...rows.filter((r) => r.id !== holderId)].map((r) => ({ id: r.id, name: r.name, relation: r.id === holderId ? null : r.relation, isHolder: r.id === holderId })),
  };
}

/** Pessoas a mais por titular (para listas: "+1 neste número"). */
export async function extraPeopleCount(holderIds: string[], tx: Db = db): Promise<Map<string, number>> {
  if (!holderIds.length) return new Map();
  const rows = await tx.select({ holder: contacts.sharesPhoneWith, n: sql<number>`count(*)::int` }).from(contacts)
    .where(inArray(contacts.sharesPhoneWith, holderIds)).groupBy(contacts.sharesPhoneWith);
  return new Map(rows.map((r) => [r.holder!, r.n]));
}

const nameKey = (s: string | null | undefined) => nameTokens(s).join(" ");

const personSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string().trim().min(2, "Informe o nome da pessoa.").max(120, "Nome muito longo."),
  relation: z.string().trim().max(40, "Use até 40 caracteres na relação.").optional().or(z.literal("")).nullable(),
  email: z.string().trim().max(200).email("E-mail inválido.").optional().or(z.literal("")),
  birthday: z.string().trim().max(10).optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
});
export type AddPersonInput = z.input<typeof personSchema>;

/**
 * Grava a pessoa a mais no número do titular (dentro da transação de quem chama). Nome que já está no número (sem diferenciar acento e
 * caixa) é recusado com a ficha que existe. Sem auditoria aqui: quem chama registra (tela) ou conta no resumo (importação do Avec).
 */
export async function addPersonTx(tx: Tx, holderId: string, p: { name: string; relation?: string | null; email?: string | null; cpf?: string | null;
  birthDay?: number | null; birthMonth?: number | null; birthYear?: number | null; clientSince?: Date | null }): Promise<{ id: string; created: boolean }> {
  // Trava o titular: duas pessoas iguais ao mesmo tempo (duplo toque, importação junto com a tela) viram uma só.
  const [holder] = await tx.select({ id: contacts.id, holder: contacts.sharesPhoneWith }).from(contacts).where(eq(contacts.id, holderId)).for("update");
  if (!holder) throw new UserFacingError("Esse contato não existe mais.");
  if (holder.holder) throw new UserFacingError("Escolha a ficha do titular do número.");
  const key = nameKey(p.name);
  const same = (await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(or(eq(contacts.id, holderId), eq(contacts.sharesPhoneWith, holderId))))
    .find((c) => nameKey(c.name) === key);
  if (same) return { id: same.id, created: false };
  const [c] = await tx.insert(contacts).values({
    name: p.name.trim().replace(/\s+/g, " "), phoneE164: newPersonPhone(), sharesPhoneWith: holderId, phoneRelation: p.relation?.trim().toLocaleLowerCase("pt-BR") || null,
    email: p.email || null, cpf: p.cpf || null, birthDay: p.birthDay ?? null, birthMonth: p.birthMonth ?? null, birthYear: p.birthYear ?? null, clientSince: p.clientSince ?? null,
  }).returning({ id: contacts.id });
  return { id: c.id, created: true };
}

/** "Adicionar pessoa" (ficha, painel Cliente da conversa, Nova cliente com telefone que já existe): nome obrigatório; relação, e-mail, CPF e aniversário opcionais. */
export async function addPersonToNumber(raw: AddPersonInput, userId: string): Promise<{ contactId: string }> {
  const input = personSchema.parse(raw);
  const cpf = cpfDigits(input.cpf);
  if (cpf && !isValidCpf(cpf)) throw new UserFacingError("CPF inválido.");
  let birth: { birthDay: number; birthMonth: number; birthYear: number | null } | null = null;
  if (input.birthday) {
    const b = parseBirthday(input.birthday);
    if (!b.ok) throw new UserFacingError(b.error);
    birth = { birthDay: b.day, birthMonth: b.month, birthYear: b.year };
  }
  return db.transaction(async (tx) => {
    const holderId = await holderIdOf(input.contactId, tx);
    const r = await addPersonTx(tx, holderId, { name: input.name, relation: input.relation, email: input.email || null, cpf: cpf || null, ...(birth ?? {}) });
    if (!r.created) throw new UserFacingError(`${input.name.trim()} já está neste número.`);
    await tx.insert(auditLog).values({ userId, action: "adicionou_pessoa_no_numero", entity: "contact", entityId: r.id, data: { titular: holderId, relacao: input.relation || null } });
    return { contactId: r.id };
  });
}

/** O telefone do número da cliente (o do titular para a pessoa a mais), em SQL, para listas e cartões que mostram ou ligam. */
export const numberPhoneSql = () => sql<string>`coalesce((select hp.phone_e164 from contacts hp where hp.id = ${contacts.sharesPhoneWith}), ${contacts.phoneE164})`;
