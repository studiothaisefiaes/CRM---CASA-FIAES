import { sql } from "drizzle-orm";
import { db } from "../db";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { businessSecondsBetween } from "../../lib/business-hours";

export type TodayItem = { id: string; name: string | null; phone: string; stageName: string; stageKey: string; slaMinutes: number | null; at: string | null; extra?: string | null };

const OFFSET = "interval '3 hours'"; // America/Bahia

export async function getToday(user: SessionUser) {
  const scope = user.role === "gestor" ? sql`true` : sql`(d.owner_id = ${user.id} or d.owner_id is null)`;
  const q = async (where: ReturnType<typeof sql>, at: ReturnType<typeof sql>, order: ReturnType<typeof sql>, extra = sql`null`) =>
    ((await db.execute(sql`
      select d.id, c.name, c.phone_e164 as phone, s.name as "stageName", s.key as "stageKey", s.sla_minutes as "slaMinutes", ${at} as at, ${extra} as extra
      from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
      where ${scope} and ${where} order by ${order} limit 40`)).rows as TodayItem[]).map((r) => ({ ...r, at: r.at ? new Date(r.at).toISOString() : null }));

  const todayLocal = sql`(now() - ${sql.raw(OFFSET)})::date`;
  const [waiting, scheduled, followups, birthdays, dues, counts] = await Promise.all([
    q(sql`d.closed_at is null and d.awaiting_reply_since is not null`, sql`d.awaiting_reply_since`, sql`d.awaiting_reply_since asc`),
    q(sql`d.scheduled_at is not null and (d.scheduled_at - ${sql.raw(OFFSET)})::date = ${todayLocal}`, sql`d.scheduled_at`, sql`d.scheduled_at asc`),
    q(sql`d.closed_at is null and s.kind = 'followup'`, sql`d.stage_entered_at`, sql`s.position desc, d.stage_entered_at asc`),
    q(sql`c.birth_month is not null and make_date(extract(year from ${todayLocal})::int, c.birth_month, least(c.birth_day, 28)) between ${todayLocal} and ${todayLocal} + 7
          and d.id = (select d2.id from deals d2 where d2.contact_id = c.id order by d2.created_at desc limit 1)`,
      sql`null`, sql`c.birth_month, c.birth_day`, sql`lpad(c.birth_day::text,2,'0') || '/' || lpad(c.birth_month::text,2,'0')`),
    q(sql`(((d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal}) or ((d.recontact_at - ${sql.raw(OFFSET)})::date = ${todayLocal}))`,
      sql`case when (d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal} then d.charge_at else d.recontact_at end`, sql`2`, sql`case when (d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal} then 'Cobrança' else 'Recontato' end`),
    db.execute(sql`select
        count(*) filter (where (d.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal})::int as novos,
        count(*) filter (where d.closed_at is null)::int as abertos,
        (select count(*)::int from alerts a where (a.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal} and a.type = 'sem_resposta_minutos' and a.audience = 'responsavel'
           ${user.role === "gestor" ? sql`` : sql`and a.user_id = ${user.id}`}) as atrasos
      from deals d where ${scope}`),
  ]);
  const resp = (await db.execute(sql`
    select count(*)::int as n, coalesce(round(avg((e.payload->>'waitedSeconds')::int)), 0)::int as avg,
      count(*) filter (where (e.payload->>'waitedSeconds')::int <= coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60)::int as within,
      coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60 as goal
    from deal_events e where e.type = 'resposta' and (e.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal}
      ${user.role === "gestor" ? sql`` : sql`and e.user_id = ${user.id}`}`)).rows[0] as { n: number; avg: number; within: number; goal: number };
  const now = Date.now(), hours = await getBusinessHours();
  const late = waiting.filter((w) => w.slaMinutes && w.at && businessSecondsBetween(new Date(w.at).getTime(), now, hours) >= w.slaMinutes * 60).length;
  return { waiting, scheduled, followups, birthdays, dues, late, resp, counts: counts.rows[0] as { novos: number; abertos: number; atrasos: number } };
}
