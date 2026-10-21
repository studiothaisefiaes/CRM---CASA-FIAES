import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts } from "../db/schema";
import { mergeNotes } from "../../lib/notes-merge";

export type NotesPlanRow = { contactId: string; name: string | null; before: string | null; after: string | null; added: number; items: { at: string; text: string }[] };
type Backup = { createdAt: string; rows: { contactId: string; before: string | null }[] };

/** Ensaio: quem tem anotação presa em lead e como o campo do contato fica. Não grava nada. */
export async function planNotesMerge(): Promise<NotesPlanRow[]> {
  const rows = (await db.execute(sql`
    select d.contact_id as "contactId", c.name, c.notes, d.created_at as at, d.observations as text
      from deals d join contacts c on c.id = d.contact_id
     where nullif(trim(d.observations), '') is not null
     order by d.contact_id, d.created_at`)).rows as { contactId: string; name: string | null; notes: string | null; at: string | Date; text: string }[];
  const by = new Map<string, NotesPlanRow>();
  for (const r of rows) {
    const row = by.get(r.contactId) ?? { contactId: r.contactId, name: r.name, before: r.notes, after: null, added: 0, items: [] };
    row.items.push({ at: new Date(r.at).toISOString(), text: r.text });
    by.set(r.contactId, row);
  }
  const out: NotesPlanRow[] = [];
  for (const row of by.values()) {
    const m = mergeNotes(row.before, row.items);
    if (m.added) out.push({ ...row, after: m.text, added: m.added });
  }
  return out;
}

/**
 * Aplica com backup (o texto de antes de cada contato, lido já travado) e auditoria. Rodar de novo não repete nada.
 * Backup que já existe é recusado: regravar por cima (rodar duas vezes no mesmo dia) apagaria o texto de antes e o desfazer.
 */
export async function applyNotesMerge(backupFile: string): Promise<{ updated: number; backup: string }> {
  if (existsSync(backupFile)) throw new Error(`O backup ${backupFile} já existe. Escolha outro nome (--backup arquivo) para não perder o anterior.`);
  const plan = await planNotesMerge();
  let updated = 0;
  await db.transaction(async (tx) => {
    const before: Backup["rows"] = [];
    for (const r of plan) {
      const [c] = await tx.select({ notes: contacts.notes }).from(contacts).where(eq(contacts.id, r.contactId)).for("update");
      if (c) before.push({ contactId: r.contactId, before: c.notes });
    }
    writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), rows: before } satisfies Backup, null, 2), { flag: "wx" });
    for (const r of plan) {
      const cur = before.find((b) => b.contactId === r.contactId);
      if (!cur) continue;
      const m = mergeNotes(cur.before, r.items);
      if (!m.added) continue;
      await tx.update(contacts).set({ notes: m.text }).where(eq(contacts.id, r.contactId));
      updated++;
    }
    await tx.insert(auditLog).values({ userId: null, action: "juntou_anotacoes", entity: "contacts", data: { contatos: updated, backup: backupFile } });
  });
  return { updated, backup: backupFile };
}

/** Desfaz com o backup: cada contato volta ao texto de antes. */
export async function restoreNotesMerge(backupFile: string): Promise<{ restored: number }> {
  const b = JSON.parse(readFileSync(backupFile, "utf8")) as Backup;
  let restored = 0;
  await db.transaction(async (tx) => {
    for (const r of b.rows) restored += (await tx.update(contacts).set({ notes: r.before }).where(eq(contacts.id, r.contactId)).returning({ id: contacts.id })).length;
    await tx.insert(auditLog).values({ userId: null, action: "desfez_juntar_anotacoes", entity: "contacts", data: { contatos: restored, backup: backupFile } });
  });
  return { restored };
}
