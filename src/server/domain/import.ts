import { inArray, sql } from "drizzle-orm";
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
  since: ["cliente desde", "data de cadastro", "cadastro", "cadastrado", "cadastrado em", "primeiro atendimento"],
  howKnown: ["como conheceu", "como nos conheceu", "como conheceu o salao"],
  code: ["codigo", "cod", "codigo do cliente"],
};
/** Celular primeiro (no Avec "Telefone" costuma ser o fixo ou vir vazio); na linha sem celular, vale o próximo que tiver número. */
const PHONE_ORDER = ["celular", "whatsapp", "telefone celular", "telefone", "fone", "phone", "tel"];
const phoneColumns = (header: string[]) => PHONE_ORDER.map((h) => header.indexOf(h)).filter((i) => i >= 0);
const phoneOf = (r: string[], ixs: number[]) => { for (const i of ixs) { const p = normalizePhone(r[i]); if (p) return p; } return null; };
const rawPhone = (r: string[], ixs: number[]) => ixs.map((i) => r[i]?.trim()).find(Boolean) ?? "";
/** Nome como veio, sem pontuação solta no começo (": Fulana" vira "Fulana"). */
const cleanName = (s: string | undefined) => s?.trim().replace(/^[\s:;,.\-]+/, "").trim() || null;
/** Aniversário "dd/mm" ou "dd/mm/aaaa": dia e mês sempre, ano só quando vier. */
function parseBirthday(s: string | undefined): { day: number; month: number; year: number | null } | null {
  const m = s?.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), y = m[3] ? Number(m[3]) : null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = y == null ? null : y < 100 ? 1900 + y : y;
  return { day, month, year: year && year > 1900 ? year : null };
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/) ?? s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [a, b, c] = m.slice(1).map(Number);
  const d = m[0].includes("-") ? new Date(Date.UTC(a, b - 1, c, 12)) : new Date(Date.UTC(c < 100 ? 2000 + c : c, b - 1, a, 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 10000;
/** Limites do arquivo, com mensagem clara; null quando está dentro. */
export function importLimitError(bytes: number, csv?: string): string | null {
  if (bytes > IMPORT_MAX_BYTES) return "Arquivo grande demais (máximo 10 MB). Divida a planilha em partes.";
  if (csv != null) { const n = parseCsv(csv).length - 1; if (n > IMPORT_MAX_ROWS) return `Planilha com ${n.toLocaleString("pt-BR")} linhas (máximo ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")}). Divida em partes.`; }
  return null;
}

export type ImportPreview = {
  /** Contatos distintos que seriam gravados (telefone válido, sem repetir). */
  rows: number; /** Linhas repetidas dentro do arquivo (mesmo telefone normalizado). */ duplicates: number;
  invalid: { line: number; value: string }[]; total: number; missingPhoneColumn?: boolean;
  /** Primeiras linhas válidas, para conferir. */ sample: { name: string | null; phone: string }[];
  /** Preenchido por `previewImportWithDb`: quantos já existem no banco (seriam só atualizados). */ existing?: number;
};

/** Prévia sem gravar nada: telefone normalizado, duplicado pelo telefone normalizado dentro do arquivo, inválidos com linha e valor. */
export function previewImport(csv: string): ImportPreview {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { rows: 0, duplicates: 0, invalid: [], total: 0, sample: [] };
  const header = rows[0].map(norm);
  const find = (k: keyof typeof HEAD) => header.findIndex((h) => HEAD[k].includes(h));
  const phoneIxs = phoneColumns(header), nameIx = find("name");
  if (!phoneIxs.length) return { rows: 0, duplicates: 0, invalid: [], total: rows.length - 1, missingPhoneColumn: true, sample: [] };
  const seen = new Map<string, { name: string | null; phone: string }>(); const invalid: { line: number; value: string }[] = []; let duplicates = 0;
  rows.slice(1).forEach((r, i) => {
    const phone = phoneOf(r, phoneIxs);
    if (!phone) { invalid.push({ line: i + 2, value: rawPhone(r, phoneIxs) }); return; }
    if (seen.has(phone)) duplicates++;
    seen.set(phone, { name: nameIx >= 0 ? cleanName(r[nameIx]) : null, phone });
  });
  return { rows: seen.size, duplicates, invalid, total: rows.length - 1, sample: [...seen.values()].slice(0, 5) };
}

/** A prévia mais quantos desses telefones já existem no banco. */
export async function previewImportWithDb(csv: string): Promise<ImportPreview> {
  const p = previewImport(csv);
  if (p.missingPhoneColumn || !p.rows) return p;
  const rows = parseCsv(csv); const header = rows[0].map(norm); const ixs = phoneColumns(header);
  const phones = [...new Set(rows.slice(1).map((r) => phoneOf(r, ixs)).filter((x): x is string => !!x))];
  let existing = 0;
  for (let i = 0; i < phones.length; i += 1000) existing += (await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.phoneE164, phones.slice(i, i + 1000)))).length;
  return { ...p, existing };
}

export type ImportReport = { total: number; imported: number; updated: number; invalid: { line: number; value: string }[]; missingPhoneColumn?: boolean };

/** Importa o histórico de clientes. Idempotente: o telefone é a chave; reimportar só atualiza. */
export async function importClients(csv: string): Promise<ImportReport> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { total: 0, imported: 0, updated: 0, invalid: [] };
  const header = rows[0].map(norm);
  const col = (k: keyof typeof HEAD) => header.findIndex((h) => HEAD[k].includes(h));
  const ix = { name: col("name"), email: col("email"), birthday: col("birthday"), last: col("lastService"), since: col("since"), howKnown: col("howKnown"), code: col("code") };
  const phoneIxs = phoneColumns(header);
  if (!phoneIxs.length) return { total: rows.length - 1, imported: 0, updated: 0, invalid: [], missingPhoneColumn: true };
  const report: ImportReport = { total: rows.length - 1, imported: 0, updated: 0, invalid: [] };
  const byPhone = new Map<string, typeof contacts.$inferInsert>();
  rows.slice(1).forEach((r, i) => {
    const phone = phoneOf(r, phoneIxs);
    if (!phone) { report.invalid.push({ line: i + 2, value: rawPhone(r, phoneIxs) }); return; }
    const bd = parseBirthday(ix.birthday >= 0 ? r[ix.birthday] : undefined);
    const email = ix.email >= 0 ? r[ix.email]?.trim() : "";
    const comoConheceu = ix.howKnown >= 0 ? r[ix.howKnown]?.trim() || null : null;
    const codigo = ix.code >= 0 ? r[ix.code]?.trim() || null : null;
    byPhone.set(phone, {
      phoneE164: phone, name: ix.name >= 0 ? cleanName(r[ix.name]) : null,
      email: email && /\S+@\S+\.\S+/.test(email) ? email : null,
      birthDay: bd?.day ?? null, birthMonth: bd?.month ?? null, birthYear: bd?.year ?? null,
      isClient: true, lastServiceAt: parseDate(ix.last >= 0 ? r[ix.last] : undefined), clientSince: parseDate(ix.since >= 0 ? r[ix.since] : undefined),
      ...(comoConheceu || codigo ? { importedFields: { avec: { comoConheceu, codigo } } } : {}),
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
        // Soma a ficha do Avec ao que já havia (ex.: a do ChatGuru), sem apagar.
        importedFields: sql`case when excluded.imported_fields is null then ${contacts.importedFields} else coalesce(${contacts.importedFields}, '{}'::jsonb) || excluded.imported_fields end`,
      },
    }).returning({ inserted: sql<boolean>`(xmax = 0)` });
    report.imported += res.filter((r) => r.inserted).length;
    report.updated += res.filter((r) => !r.inserted).length;
  }
  return report;
}
