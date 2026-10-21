import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, contacts, professionals } from "../db/schema";
import { UserFacingError } from "./errors";
import { parseBirthday } from "../../lib/birthday";
import { cpfDigits, isValidCpf } from "../../lib/cpf";
import { normalizePhone } from "./phone";
import { assertFuncao } from "./funcoes";
import { can } from "../../lib/permissions";
import { todayBahia } from "../../lib/agenda";
import { IMAGE_USES } from "../../lib/client-alert";

export const ALERT_NOTES_MAX = 300;
export const contactProfileSchema = z.object({
  name: z.string().max(120, "Use até 120 caracteres.").nullable().optional(),
  email: z.union([z.string().trim().email("E-mail inválido."), z.literal(""), z.null()]).optional(),
  birthday: z.string().nullable().optional(),
  notes: z.string().max(4000, "Use até 4.000 caracteres.").nullable().optional(),
  alertNotes: z.string().max(ALERT_NOTES_MAX, `Use até ${ALERT_NOTES_MAX} caracteres.`).nullable().optional(),
  preferredProfessionalId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  /** CPF: com ou sem máscara; guardado só com os 11 dígitos. Vazio apaga. */
  cpf: z.string().max(20).nullable().optional(),
  /** Dados da cliente (painel da conversa, 16/10). */
  nickname: z.string().max(60, "Use até 60 caracteres.").nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  phoneAlt: z.string().max(30).nullable().optional(),
  instagram: z.string().max(60, "Use até 60 caracteres.").nullable().optional(),
  hairType: z.string().max(120, "Use até 120 caracteres.").nullable().optional(),
  /** Uso de imagem (0081): "sim", "nao" ou null (não informado). "sim" sem data grava hoje; qualquer outro apaga a data. */
  imageUse: z.enum(IMAGE_USES, "Uso de imagem inválido.").nullable().optional(),
  /** Desde quando autorizou: "AAAA-MM-DD". Só vale com "sim". */
  imageUseOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida. Use dia/mês/ano.").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Data inválida. Use dia/mês/ano.").refine((d) => d >= "2000-01-01", "Data inválida: use de 2000 em diante.").nullable().optional(),
});
export type ContactProfilePatch = z.input<typeof contactProfileSchema>;

const LABEL: Record<string, string> = {
  name: "Nome", email: "E-mail", birthday: "Aniversário", notes: "Anotações", alertNotes: "Avisos fixos", preferredProfessionalId: "Profissional preferida", cpf: "CPF",
  nickname: "Como gosta de ser chamada", imageUse: "Uso de imagem", imageUseOn: "Uso de imagem desde", phone: "WhatsApp", phoneAlt: "Outro telefone", instagram: "Instagram", hairType: "Tipo de cabelo",
};
const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/**
 * Edição na ficha e no "Editar dados" da conversa: nome, como gosta de ser chamada, WhatsApp, outro telefone, aniversário, e-mail,
 * Instagram, profissional preferida, tipo de cabelo, alergias e cuidados (avisos fixos), observações (anotações) e CPF.
 * Grava só o que mudou e registra na auditoria (`atualizou_contato`). Vazio apaga; profissional vazia volta para a calculada.
 * Uso de imagem (e a data) só muda com a função `uso_imagem` ligada e a permissão `contatos.uso_imagem` em `perms`; mandar o valor que já está não conta.
 */
export async function updateContactProfile(contactId: string, raw: ContactProfilePatch, userId: string, perms: readonly string[] = [], now = new Date()): Promise<{ changed: string[] }> {
  const parsed = contactProfileSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Dado inválido.");
  const p = parsed.data;
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const set: Partial<typeof contacts.$inferInsert> = {};
    const changed: string[] = [];
    const put = (field: string, patch: Partial<typeof contacts.$inferInsert>) => { Object.assign(set, patch); changed.push(field); };
    if (p.name !== undefined && blank(p.name) !== c.name) put("name", { name: blank(p.name) });
    if (p.email !== undefined && blank(p.email) !== c.email) put("email", { email: blank(p.email) });
    if (p.notes !== undefined && blank(p.notes) !== c.notes) put("notes", { notes: blank(p.notes) });
    if (p.alertNotes !== undefined && blank(p.alertNotes) !== c.alertNotes) put("alertNotes", { alertNotes: blank(p.alertNotes) });
    if (p.nickname !== undefined && blank(p.nickname) !== c.nickname) put("nickname", { nickname: blank(p.nickname) });
    if (p.hairType !== undefined && blank(p.hairType) !== c.hairType) put("hairType", { hairType: blank(p.hairType) });
    if (p.instagram !== undefined) {
      const ig = blank(p.instagram)?.replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "") || null;
      if (ig && !/^[a-z0-9._]{1,30}$/i.test(ig)) throw new UserFacingError("Instagram inválido. Use só o @usuario.");
      if (ig !== c.instagram) put("instagram", { instagram: ig });
    }
    if (p.phoneAlt !== undefined) {
      const t = blank(p.phoneAlt);
      const alt = t ? normalizePhone(t) ?? (t.replace(/\D/g, "").length >= 8 ? t.replace(/[^\d()+ -]/g, "") : null) : null;
      if (t && !alt) throw new UserFacingError("Outro telefone inválido. Use DDD + número.");
      if (alt !== c.phoneAlt) put("phoneAlt", { phoneAlt: alt });
    }
    if (p.phone !== undefined) {
      // O WhatsApp é por onde a conversa anda: só troca para um número válido que não seja de outra cliente.
      const phone = normalizePhone(p.phone);
      if (!phone) throw new UserFacingError("WhatsApp inválido. Use DDD + número, ex.: 71 99999-9999.");
      if (phone !== c.phoneE164) {
        if (c.phoneE164.startsWith("lid:")) throw new UserFacingError("Essa cliente está com o número oculto no WhatsApp: o número não muda por aqui.");
        const [other] = await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.phoneE164, phone));
        if (other) throw new UserFacingError(`Esse número já é de outra cliente${other.name ? ` (${other.name})` : ""}. Se é a mesma pessoa, use Unir cadastros.`);
        // Ela estava no número de outra pessoa (a filha, 0051): com número próprio, deixa de ser "pessoa a mais" e vira cliente com WhatsApp dela (20/10).
        put("phone", c.sharesPhoneWith ? { phoneE164: phone, sharesPhoneWith: null, phoneRelation: null } : { phoneE164: phone });
      }
    }
    if (p.cpf !== undefined) {
      const d = cpfDigits(p.cpf);
      if (d && !isValidCpf(d)) throw new UserFacingError("CPF inválido.");
      // Na auditoria vai só o nome do campo, nunca o número.
      if ((d || null) !== c.cpf) put("cpf", { cpf: d || null });
    }
    if (p.birthday !== undefined) {
      const text = blank(p.birthday);
      if (!text) { if (c.birthDay != null) put("birthday", { birthDay: null, birthMonth: null, birthYear: null }); }
      else {
        const b = parseBirthday(text);
        if (!b.ok) throw new UserFacingError(b.error);
        if (b.day !== c.birthDay || b.month !== c.birthMonth || b.year !== c.birthYear) put("birthday", { birthDay: b.day, birthMonth: b.month, birthYear: b.year });
      }
    }
    if (p.preferredProfessionalId !== undefined) {
      const id = p.preferredProfessionalId || null;
      if (id && !(await tx.select({ id: professionals.id }).from(professionals).where(eq(professionals.id, id))).length) throw new UserFacingError("Essa profissional não existe mais.");
      if (id !== c.preferredProfessionalId) put("preferredProfessionalId", { preferredProfessionalId: id });
    }
    if (p.imageUse !== undefined || p.imageUseOn !== undefined) {
      const use = p.imageUse !== undefined ? p.imageUse : c.imageUse;
      let on = p.imageUseOn !== undefined ? p.imageUseOn : c.imageUseOn;
      if (use !== "sim") {
        if (p.imageUseOn) throw new UserFacingError("A data só vale para quem autorizou.");
        on = null;
      } else if (p.imageUse === "sim" && c.imageUse !== "sim" && !on) on = todayBahia(now);
      if (on && on > todayBahia(now)) throw new UserFacingError("A data não pode ser depois de hoje.");
      if (use !== (c.imageUse ?? null) || on !== (c.imageUseOn ?? null)) {
        await assertFuncao("uso_imagem", tx);
        if (!can(perms, "contatos.uso_imagem")) throw new UserFacingError("Você não tem permissão para isso.");
        // A data anda junto com o valor ("sim" põe hoje, "não" e vazio apagam): só aparece em "changed" quando mudou sozinha.
        if (use !== (c.imageUse ?? null)) put("imageUse", { imageUse: use ?? null, imageUseOn: on ?? null });
        else put("imageUseOn", { imageUseOn: on ?? null });
      }
    }
    if (!changed.length) return { changed };
    await tx.update(contacts).set(set).where(eq(contacts.id, contactId));
    await tx.insert(auditLog).values({ userId, action: "atualizou_contato", entity: "contact", entityId: contactId, data: { campos: changed.map((k) => LABEL[k] ?? k) } });
    return { changed };
  });
}
