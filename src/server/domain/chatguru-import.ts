import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { chatguruRecords, contacts } from "../db/schema";
import { normalizePhone } from "./phone";
import { addTag, TAG_MAX } from "./tags";
import { forbiddenColumns } from "./avec/sanitize";

/** O que o diálogo "Post para URL" do ChatGuru manda (só os campos que usamos; o resto fica no registro cru). */
export type ChatguruPayload = {
  chat_id?: string; celular?: string; nome?: string; tags?: unknown; campos_personalizados?: unknown;
  responsavel_nome?: string | null; link_chat?: string | null; chat_created?: string | null;
};
export type ChatguruImportResult = { ok: true; created: boolean; contactId: string } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Importa a ficha de um chat do ChatGuru: acha (ou cria, sem lead) o contato pelo número, põe as etiquetas de lá como etiquetas daqui e guarda
 * campos personalizados, responsável, data de cadastro e o link do chat em `importedFields.chatguru`. Idempotente por chat: mandar de novo
 * atualiza os campos e soma etiquetas (nunca tira as que a equipe pôs aqui). O registro cru fica em `chatguru_records`, inclusive com erro.
 */
export async function importChatguruRecord(input: ChatguruPayload): Promise<ChatguruImportResult> {
  // CPF, RG, endereço, banco: nunca ficam guardados, nem no registro cru (mesma regra do Avec). A lista de chaves é calculada antes de apagar.
  const rawCampos = input.campos_personalizados && typeof input.campos_personalizados === "object" && !Array.isArray(input.campos_personalizados)
    ? { ...(input.campos_personalizados as Record<string, unknown>) } : null;
  if (rawCampos) { const keys = Object.keys(rawCampos); for (const i of forbiddenColumns(keys)) delete rawCampos[keys[i]]; }
  const payload: ChatguruPayload = rawCampos ? { ...input, campos_personalizados: rawCampos } : input;
  const chatId = str(payload.chat_id) || `sem-id:${str(payload.celular)}`;
  const phone = normalizePhone(str(payload.celular));
  await db.insert(chatguruRecords).values({ chatId, phone, payload: payload as Record<string, unknown> })
    .onConflictDoUpdate({ target: chatguruRecords.chatId, set: { phone, payload: payload as Record<string, unknown>, receivedAt: new Date(), appliedAt: null, error: null } });
  if (!phone) {
    const error = "Sem número de WhatsApp válido no registro.";
    await db.update(chatguruRecords).set({ error }).where(eq(chatguruRecords.chatId, chatId));
    return { ok: false, error };
  }
  const campos = Object.fromEntries(Object.entries(payload.campos_personalizados && typeof payload.campos_personalizados === "object" ? payload.campos_personalizados as Record<string, unknown> : {})
    .filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => [k.slice(0, 60), String(v).slice(0, 500)]));
  const chatguru = {
    campos, responsavel: str(payload.responsavel_nome) || null, desde: str(payload.chat_created).slice(0, 10) || null,
    link: str(payload.link_chat) || null, atualizadoEm: new Date().toISOString(),
  };
  const name = str(payload.nome).slice(0, 120) || null;
  const [inserted] = await db.insert(contacts).values({ phoneE164: phone, name, importedFields: { chatguru } }).onConflictDoNothing().returning({ id: contacts.id });
  let contactId = inserted?.id;
  if (!contactId) {
    // Já existe (veio do WhatsApp ou de outra importação): completa a ficha; o nome só entra se ainda não houver um.
    const scalars = Object.fromEntries(Object.entries({ responsavel: chatguru.responsavel, desde: chatguru.desde, link: chatguru.link, atualizadoEm: chatguru.atualizadoEm })
      .filter(([, v]) => v != null && v !== ""));
    // Junta com o que já veio antes (outro CSV, outro "Post para URL"): campos se somam; responsável, data e link só mudam quando vêm preenchidos.
    const [c] = await db.update(contacts).set({
      importedFields: sql`jsonb_set(coalesce(${contacts.importedFields}, '{}'::jsonb), '{chatguru}',
        coalesce(${contacts.importedFields}->'chatguru', '{}'::jsonb) || ${JSON.stringify(scalars)}::jsonb
        || jsonb_build_object('campos', coalesce(${contacts.importedFields}->'chatguru'->'campos', '{}'::jsonb) || ${JSON.stringify(campos)}::jsonb))`,
      name: sql`coalesce(nullif(trim(${contacts.name}), ''), ${name})`,
    }).where(eq(contacts.phoneE164, phone)).returning({ id: contacts.id });
    contactId = c.id;
  }
  const tagNames = Array.isArray(payload.tags) ? payload.tags.map(str).filter((t) => t && t.length <= TAG_MAX) : [];
  for (const t of new Set(tagNames)) await addTag(contactId, t, null, { imported: true }); // importação: não dispara regra
  await db.update(chatguruRecords).set({ appliedAt: new Date() }).where(eq(chatguruRecords.chatId, chatId));
  return { ok: true, created: !inserted ? false : true, contactId };
}
