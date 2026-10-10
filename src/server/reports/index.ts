import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";

export type Period = "hoje" | "7d" | "mes" | "ano";
export const PERIOD_LABEL: Record<Period, string> = { hoje: "Hoje", "7d": "7 dias", mes: "Este mês", ano: "Este ano" };
export type ReportFilter = { period: Period; ownerId?: string | null; origin?: string | null };

/** Início do período no fuso de Salvador (UTC-3). */
export function periodStart(p: Period, now = new Date()): Date {
  const local = new Date(now.getTime() - 3 * 3_600_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const startLocal = p === "hoje" ? Date.UTC(y, m, d) : p === "7d" ? Date.UTC(y, m, d - 6) : p === "mes" ? Date.UTC(y, m, 1) : Date.UTC(y, 0, 1);
  return new Date(startLocal + 3 * 3_600_000);
}

function dealScope(f: ReportFilter, alias = "d"): SQL {
  const parts: SQL[] = [sql`${sql.raw(alias)}.archived_at is null`];
  if (f.ownerId && /^[0-9a-f-]{36}$/i.test(f.ownerId)) parts.push(sql`${sql.raw(alias)}.owner_id = ${f.ownerId}`);
  if (f.origin) parts.push(sql`${sql.raw(alias)}.origin = ${f.origin}`);
  return sql.join(parts, sql` and `);
}

const rows = async <T>(q: SQL) => (await db.execute(q)).rows as T[];

export async function funnel(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  return rows<{ key: string; name: string; kind: string; position: number; reached: number }>(sql`
    with base as (select d.id, d.stage_id from deals d where d.created_at >= ${from}::timestamptz and ${dealScope(f)}),
    hits as (
      select b.id, s.id as stage_id from base b join stages s on s.kind = 'lead'
      union select b.id, b.stage_id from base b
      union select e.deal_id, s.id from deal_events e join base b on b.id = e.deal_id join stages s on s.key = e.payload->>'para' where e.type = 'etapa_alterada'
    )
    select s.key, s.name, s.kind, s.position, count(distinct h.id)::int as reached
    from stages s left join hits h on h.stage_id = s.id where s.active group by s.id order by s.position`);
}

export async function responseTimes(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  return rows<{ userId: string | null; name: string; responses: number; avgSeconds: number; medianSeconds: number; withinGoal: number; goalSeconds: number; alerts: number }>(sql`
    with goal as (select coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60 as s),
    r as (
      select e.user_id, (e.payload->>'waitedSeconds')::int as w from deal_events e join deals d on d.id = e.deal_id
      where e.type = 'resposta' and e.created_at >= ${from}::timestamptz and ${dealScope(f)}
    ),
    a as (select user_id, count(*)::int as n from alerts where type = 'sem_resposta_minutos' and user_id is not null and created_at >= ${from}::timestamptz group by user_id)
    select r.user_id as "userId", coalesce(u.name, 'Sem responsável') as name, count(*)::int as responses,
      round(avg(r.w))::int as "avgSeconds", percentile_cont(0.5) within group (order by r.w)::int as "medianSeconds",
      count(*) filter (where r.w <= (select s from goal))::int as "withinGoal", (select s from goal)::int as "goalSeconds",
      coalesce(max(a.n), 0)::int as alerts
    from r left join users u on u.id = r.user_id left join a on a.user_id = r.user_id
    group by r.user_id, u.name order by "avgSeconds" asc`);
}

export async function origins(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  return rows<{ origin: string; leads: number; won: number; revenueCents: number }>(sql`
    select d.origin, count(*)::int as leads, count(*) filter (where s.kind = 'fechado')::int as won,
      coalesce(sum(d.value_cents) filter (where s.kind = 'fechado'), 0)::bigint::int as "revenueCents"
    from deals d join stages s on s.id = d.stage_id where d.created_at >= ${from}::timestamptz and ${dealScope(f)}
    group by d.origin order by leads desc`);
}

export async function objections(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  const obj = await rows<{ label: string; n: number }>(sql`
    select l.label, count(*)::int as n from deals d join lists l on l.id = d.objection_id
    where d.created_at >= ${from}::timestamptz and ${dealScope(f)} group by l.label order by n desc`);
  const lost = await rows<{ label: string; n: number }>(sql`
    select l.label, count(*)::int as n from deals d join lists l on l.id = d.lost_reason_id
    where d.closed_at >= ${from}::timestamptz and ${dealScope(f)} group by l.label order by n desc`);
  return { objections: obj, lostReasons: lost };
}

export async function finance(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  const byMethod = await rows<{ method: string | null; n: number; totalCents: number }>(sql`
    select d.payment_method as method, count(*)::int as n, coalesce(sum(d.value_cents), 0)::bigint::int as "totalCents"
    from deals d join stages s on s.id = d.stage_id where s.kind = 'fechado' and d.closed_at >= ${from}::timestamptz and ${dealScope(f)}
    group by d.payment_method order by "totalCents" desc`);
  const totalCents = byMethod.reduce((a, b) => a + Number(b.totalCents), 0);
  const deals = byMethod.reduce((a, b) => a + b.n, 0);
  const upcoming = await rows<{ id: string; name: string | null; phone: string; chargeAt: string; valueCents: number | null }>(sql`
    select d.id, c.name, c.phone_e164 as phone, d.charge_at as "chargeAt", d.value_cents as "valueCents"
    from deals d join contacts c on c.id = d.contact_id where d.charge_at >= now() and ${dealScope(f)} order by d.charge_at limit 30`);
  return { byMethod, totalCents, deals, ticketCents: deals ? Math.round(totalCents / deals) : 0, upcoming };
}

export async function summary(f: ReportFilter) {
  const from = periodStart(f.period).toISOString();
  const [r] = await rows<{ leads: number; won: number; lost: number; open: number }>(sql`
    select count(*) filter (where d.created_at >= ${from}::timestamptz)::int as leads,
      count(*) filter (where s.kind = 'fechado' and d.closed_at >= ${from}::timestamptz)::int as won,
      count(*) filter (where s.kind = 'perdido' and d.closed_at >= ${from}::timestamptz)::int as lost,
      count(*) filter (where d.closed_at is null)::int as open
    from deals d join stages s on s.id = d.stage_id where ${dealScope(f)}`);
  return r;
}

/** CSV com BOM e ; (abre direto no Excel em português). */
export function toCsv(header: string[], data: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [header, ...data].map((r) => r.map(esc).join(";")).join("\r\n");
}
