import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";

export type Period = "hoje" | "7d" | "mes" | "ano";
export const PERIOD_LABEL: Record<Period, string> = { hoje: "Hoje", "7d": "7 dias", mes: "Este mês", ano: "Este ano" };

export type ReportFilter = {
  period: Period;
  ownerId?: string | null;
  /** Filtro legado pelo campo `deals.origin`. */
  origin?: string | null;
  /** Rótulo da origem real (`deals.source_label`); "Não identificada" filtra os leads sem origem. */
  source?: string | null;
  /** Devolve também o período anterior (`previous`) nas consultas que o suportam. */
  compare?: boolean;
  /** Relógio do relatório (padrão: agora). Os testes fixam esta data. */
  now?: Date;
};

export const NOT_IDENTIFIED = "Não identificada";
/** Tamanho mínimo de amostra para mostrar % ou comparar pessoas. */
export const MIN_SAMPLE = 20;

const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;

/** Início do período no fuso de Salvador (UTC-3). */
export function periodStart(p: Period, now = new Date()): Date {
  const local = new Date(now.getTime() - BAHIA_OFFSET_MS);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const startLocal = p === "hoje" ? Date.UTC(y, m, d) : p === "7d" ? Date.UTC(y, m, d - 6) : p === "mes" ? Date.UTC(y, m, 1) : Date.UTC(y, 0, 1);
  return new Date(startLocal + BAHIA_OFFSET_MS);
}

export type Window = { from: Date; to: Date };
export type PeriodWindow = Window & { prevFrom: Date; prevTo: Date };

/**
 * Janela do período atual (de `from` até `to` = agora, inclusive) e a do período anterior de mesmo tamanho.
 * Hoje compara com ontem até a mesma hora; 7 dias com os 7 dias antes; mês e ano com o mês/ano anterior pelo mesmo tempo decorrido.
 */
export function periodWindow(f: Pick<ReportFilter, "period" | "now">): PeriodWindow {
  const to = f.now ?? new Date();
  const from = periodStart(f.period, to);
  const len = to.getTime() - from.getTime();
  const local = new Date(from.getTime() - BAHIA_OFFSET_MS);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  const prevFromMs = f.period === "hoje" ? from.getTime() - DAY_MS
    : f.period === "7d" ? from.getTime() - 7 * DAY_MS
    : f.period === "mes" ? Date.UTC(y, m - 1, 1) + BAHIA_OFFSET_MS
    : Date.UTC(y - 1, 0, 1) + BAHIA_OFFSET_MS;
  const prevFrom = new Date(prevFromMs);
  return { from, to, prevFrom, prevTo: new Date(Math.min(prevFromMs + len, from.getTime())) };
}

export const iso = (d: Date) => d.toISOString();
export const rows = async <T>(q: SQL) => (await db.execute(q)).rows as T[];
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((100 * part) / whole) : null);

/** Rótulo da origem real do lead: link/QR e evidência vêm de `source_label`; sem ela, a origem legada só vale se não for o canal. */
export const SOURCE_EXPR = (alias = "d") => sql`coalesce(${sql.raw(alias)}.source_label,
  case when lower(${sql.raw(alias)}.origin) in ('whatsapp', 'já é cliente') then null else ${sql.raw(alias)}.origin end, ${NOT_IDENTIFIED}::text)`;

/**
 * Leads que valem para os relatórios: sem arquivados, sem contato ignorado e com os filtros de pessoa/origem.
 * `novos` também tira os leads de histórico importado (`lead_criado.payload.historico`): conversa antiga não é lead novo.
 */
export function dealScope(f: ReportFilter, alias = "d", opts: { novos?: boolean } = {}): SQL {
  const a = sql.raw(alias);
  const parts: SQL[] = [
    sql`${a}.archived_at is null`,
    sql`not exists (select 1 from contacts ic where ic.id = ${a}.contact_id and ic.ignored)`,
  ];
  if (opts.novos) parts.push(sql`not exists (select 1 from deal_events he where he.deal_id = ${a}.id and he.type = 'lead_criado' and he.payload->>'historico' = 'true')`);
  if (f.ownerId && /^[0-9a-f-]{36}$/i.test(f.ownerId)) parts.push(sql`${a}.owner_id = ${f.ownerId}`);
  if (f.origin) parts.push(sql`${a}.origin = ${f.origin}`);
  if (f.source) parts.push(sql`${SOURCE_EXPR(alias)} = ${f.source}`);
  return sql.join(parts, sql` and `);
}

/** Coorte: os leads novos criados de `from` até `to` (inclusive: o instante de agora entra). */
export const cohort = (f: ReportFilter, w: Window, alias = "d"): SQL =>
  sql`${sql.raw(alias)}.created_at >= ${iso(w.from)}::timestamptz and ${sql.raw(alias)}.created_at <= ${iso(w.to)}::timestamptz and ${dealScope(f, alias, { novos: true })}`;

/** CSV com BOM e ; (abre direto no Excel em português). */
export function toCsv(header: string[], data: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [header, ...data].map((r) => r.map(esc).join(";")).join("\r\n");
}
