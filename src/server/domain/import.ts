import { sql } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";
import { normalizePhone } from "./phone";

/** CSV simples com aspas, separador ; ou , (detectado), BOM e quebras de linha \r\n. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const HEAD: Record<string, string[]> = {
  name: ["nome", "cliente", "nome do cliente", "name"],
  phone: ["telefone", "celular", "whatsapp", "fone", "phone", "telefone celular", "tel"],
  email: ["email", "e-mail"],
  birthday: ["aniversario", "nascimento", "data de nascimento", "data nascimento"],
  lastService: ["ultimo atendimento", "ultima visita", "data do ultimo atendimento", "ultimo servico"],
  since: ["cliente desde", "data de cadastro", "cadastro", "primeiro atendimento"],
};

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/) ?? s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [a, b, c] = m.slice(1).map(Number);
  const d = m[0].includes("-") ? new Date(Date.UTC(a, b - 1, c, 12)) : new Date(Date.UTC(c < 100 ? 2000 + c : c, b - 1, a, 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ImportReport = { total: number; imported: number; updated: number; invalid: { line: number; value: string }[]; missingPhoneColumn?: boolean };

/** Importa o histórico de clientes. Idempotente: o telefone é a chave; reimportar só atualiza. */
export async function importClients(csv: string): Promise<ImportReport> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { total: 0, imported: 0, updated: 0, invalid: [] };
  const header = rows[0].map(norm);
  const col = (k: keyof typeof HEAD) => header.findIndex((h) => HEAD[k].includes(h));
  const ix = { name: col("name"), phone: col("phone"), email: col("email"), birthday: col("birthday"), last: col("lastService"), since: col("since") };
  if (ix.phone < 0) return { total: rows.length - 1, imported: 0, updated: 0, invalid: [], missingPhoneColumn: true };
  const report: ImportReport = { total: rows.length - 1, imported: 0, updated: 0, invalid: [] };
  const byPhone = new Map<string, typeof contacts.$inferInsert>();
  rows.slice(1).forEach((r, i) => {
    const phone = normalizePhone(r[ix.phone]);
    if (!phone) { report.invalid.push({ line: i + 2, value: r[ix.phone] ?? "" }); return; }
    const bd = parseDate(ix.birthday >= 0 ? r[ix.birthday] : undefined);
    const email = ix.email >= 0 ? r[ix.email]?.trim() : "";
    byPhone.set(phone, {
      phoneE164: phone, name: ix.name >= 0 ? r[ix.name]?.trim() || null : null,
      email: email && /\S+@\S+\.\S+/.test(email) ? email : null,
      birthDay: bd ? bd.getUTCDate() : null, birthMonth: bd ? bd.getUTCMonth() + 1 : null, birthYear: bd && bd.getUTCFullYear() > 1900 ? bd.getUTCFullYear() : null,
      isClient: true, lastServiceAt: parseDate(ix.last >= 0 ? r[ix.last] : undefined), clientSince: parseDate(ix.since >= 0 ? r[ix.since] : undefined),
    });
  });
  const values = [...byPhone.values()];
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const res = await db.insert(contacts).values(chunk).onConflictDoUpdate({
      target: contacts.phoneE164,
      set: {
        isClient: sql`true`,
        name: sql`coalesce(${contacts.name}, excluded.name)`,
        email: sql`coalesce(${contacts.email}, excluded.email)`,
        birthDay: sql`coalesce(${contacts.birthDay}, excluded.birth_day)`,
        birthMonth: sql`coalesce(${contacts.birthMonth}, excluded.birth_month)`,
        birthYear: sql`coalesce(${contacts.birthYear}, excluded.birth_year)`,
        lastServiceAt: sql`greatest(${contacts.lastServiceAt}, excluded.last_service_at)`,
        clientSince: sql`least(${contacts.clientSince}, excluded.client_since)`,
      },
    }).returning({ inserted: sql<boolean>`(xmax = 0)` });
    report.imported += res.filter((r) => r.inserted).length;
    report.updated += res.filter((r) => !r.inserted).length;
  }
  return report;
}
