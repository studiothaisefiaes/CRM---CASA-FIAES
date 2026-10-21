import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { contactNotes, contacts, contactTags, tags } from "../src/server/db/schema";
import { decodeCsv, parseChatguruCsv } from "../src/server/domain/chatguru-csv";
import { applyChatguruCsv, previewChatguruCsv } from "../src/server/domain/chatguru-csv-import";

/**
 * Importa um CSV do ChatGuru em produção.
 *   --dry-run <arquivo.csv>  só a prévia (nada é gravado)
 *   --aplicar <arquivo.csv>  backup JSON dos contatos que serão tocados (BACKUP_DIR, padrão ./backups), importa e confere
 * Nunca envia mensagem nem cria lead. O backup fica no servidor, nunca no repositório.
 */
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!["--dry-run", "--aplicar"].includes(mode ?? "") || !file) throw new Error("Uso: --dry-run arquivo.csv | --aplicar arquivo.csv");
  const text = decodeCsv(await readFile(file));
  const prev = await previewChatguruCsv(text);
  console.log(`Arquivo: ${prev.kind} · ${prev.total} linhas · ${prev.valid} válidas · ${prev.invalid.length} sem número válido`);
  console.log(`Contatos: ${prev.existing} já existem, ${prev.newContacts} novos · etiquetas: ${prev.tags.join(", ") || "nenhuma"} · anotações: ${prev.notes}`);
  if (prev.removedColumns.length) console.log(`Descartadas (dados pessoais): ${prev.removedColumns.join(", ")}`);
  if (prev.ignoredColumns.length) console.log(`Não usadas: ${prev.ignoredColumns.join(", ")}`);
  if (mode === "--dry-run") { console.log("Ensaio: nada foi gravado."); return; }
  const phones = [...new Set(parseChatguruCsv(text).rows.map((r) => r.phone))];
  const before = phones.length ? await db.select().from(contacts).where(inArray(contacts.phoneE164, phones)) : [];
  const ids = before.map((c) => c.id);
  const em = new Date().toISOString();
  const backup = {
    em, arquivo: path.basename(file),
    contatos: before.map((c) => ({ id: c.id, phone: c.phoneE164, name: c.name, importedFields: c.importedFields })),
    etiquetas: ids.length ? await db.select({ contactId: contactTags.contactId, tag: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(inArray(contactTags.contactId, ids)) : [],
    notas: ids.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(contactNotes).where(inArray(contactNotes.contactId, ids)))[0].n : 0,
  };
  const dir = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `chatguru-csv-${em.replace(/[:.]/g, "-")}-antes.json`);
  await writeFile(out, JSON.stringify(backup, null, 2));
  console.log(`Backup: ${out}`);
  const r = await applyChatguruCsv(text, null);
  console.log(`Feito: ${r.contacts} contatos tocados, ${r.created} criados, ${r.notes} notas novas, ${r.invalid} linhas sem número válido.`);
  const after = phones.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(inArray(contacts.phoneE164, phones)))[0].n : 0;
  console.log(`Conferência: ${after} contatos com esses números (antes ${before.length}; esperado ${before.length + prev.newContacts}).`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
