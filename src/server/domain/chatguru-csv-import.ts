import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contactNotes, contacts } from "../db/schema";
import { importChatguruRecord } from "./chatguru-import";
import { parseChatguruCsv, type ChatguruCsvKind } from "./chatguru-csv";
import { UserFacingError } from "./errors";

export const CHATGURU_CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CHATGURU_CSV_MAX_ROWS = 20_000;
export type ChatguruImportPreview = { kind: ChatguruCsvKind; total: number; valid: number; invalid: { line: number; value: string }[]; existing: number; newContacts: number; tags: string[]; notes: number; ignoredColumns: string[]; removedColumns: string[] };
export type ChatguruImportReport = { kind: ChatguruCsvKind; contacts: number; created: number; notes: number; invalid: number };

function parseChecked(text: string) {
  if (Buffer.byteLength(text, "utf8") > CHATGURU_CSV_MAX_BYTES) throw new UserFacingError("O arquivo passa de 10 MB. Exporte por período e envie em partes.");
  const p = parseChatguruCsv(text);
  if (p.total > CHATGURU_CSV_MAX_ROWS) throw new UserFacingError(`O arquivo tem mais de ${CHATGURU_CSV_MAX_ROWS.toLocaleString("pt-BR")} linhas. Envie em partes.`);
  return p;
}

/** Prévia: o que vai entrar, sem gravar nada. */
export async function previewChatguruCsv(text: string): Promise<ChatguruImportPreview> {
  const p = parseChecked(text);
  const phones = [...new Set(p.rows.map((r) => r.phone))];
  const existing = phones.length ? (await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.phoneE164, phones))).length : 0;
  return {
    kind: p.kind, total: p.total, valid: p.rows.length, invalid: p.invalid.slice(0, 50), existing, newContacts: phones.length - existing,
    tags: [...new Set(p.rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "pt-BR")), notes: p.rows.filter((r) => r.note).length,
    ignoredColumns: p.ignoredColumns, removedColumns: p.removedColumns,
  };
}

/** Contato pelo número; se não existe, nasce sem lead (como no "Post para URL"). */
async function contactIdFor(phone: string, name: string | null): Promise<string> {
  const [found] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
  if (found) return found.id;
  const [c] = await db.insert(contacts).values({ phoneE164: phone, name }).onConflictDoNothing().returning({ id: contacts.id });
  return c?.id ?? (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone)))[0].id;
}

/**
 * Importa idempotente pelo número. Chats e Funil passam por `importChatguruRecord` (etiquetas somadas, ficha juntada, sem lead).
 * Anotações viram notas internas (`source: "chatguru"`), uma vez só (`externalKey` = número + data + autora + texto).
 */
export async function applyChatguruCsv(text: string, userId: string | null): Promise<ChatguruImportReport> {
  const p = parseChecked(text);
  let created = 0, notes = 0;
  const touched = new Set<string>();
  for (const r of p.rows) {
    if (p.kind === "anotacoes" && r.note) {
      const contactId = await contactIdFor(r.phone, r.name);
      touched.add(contactId);
      const key = createHash("sha1").update(`${r.phone}|${r.note.at ?? ""}|${r.note.author ?? ""}|${r.note.text}`).digest("hex");
      const [ins] = await db.insert(contactNotes).values({
        contactId, authorName: r.note.author?.slice(0, 60) ?? "ChatGuru", body: r.note.text.slice(0, 2000), source: "chatguru", externalKey: `chatguru:${key}`,
        ...(r.note.at ? { createdAt: new Date(r.note.at) } : {}),
      }).onConflictDoNothing().returning({ id: contactNotes.id });
      if (ins) notes++;
      continue;
    }
    const res = await importChatguruRecord({
      chat_id: `csv-${p.kind}:${r.phone}`, celular: r.phone, nome: r.name ?? undefined, tags: r.tags, link_chat: r.link, chat_created: r.since,
      responsavel_nome: r.responsavel, campos_personalizados: r.stage ? { "Etapa no ChatGuru": r.stage } : undefined,
    });
    if (res.ok) { touched.add(res.contactId); if (res.created) created++; }
  }
  await db.insert(auditLog).values({ userId, action: "importou", entity: "chatguru_csv", entityId: null, data: { tipo: p.kind, contatos: touched.size, criados: created, notas: notes, invalidas: p.invalid.length } });
  return { kind: p.kind, contacts: touched.size, created, notes, invalid: p.invalid.length };
}
