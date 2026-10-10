// Consultas da tela antiga de Relatórios. A T13b troca a tela pelas consultas novas (queries.ts) e estas saem.
import { sql } from "drizzle-orm";
import { cohort, dealScope, iso, periodWindow, rows, SOURCE_EXPR, type ReportFilter } from "./common";

/** @deprecated use funnelMilestones. */
export async function funnel(f: ReportFilter) {
  const w = periodWindow(f);
  return rows<{ key: string; name: string; kind: string; position: number; reached: number }>(sql`
    with base as (select d.id, d.stage_id from deals d where ${cohort(f, w)}),
    hits as (
      select b.id, s.id as stage_id from base b join stages s on s.kind = 'lead'
      union select b.id, b.stage_id from base b
      union select e.deal_id, s.id from deal_events e join base b on b.id = e.deal_id join stages s on s.key = e.payload->>'para' where e.type = 'etapa_alterada'
    )
    select s.key, s.name, s.kind, s.position, count(distinct h.id)::int as reached
    from stages s left join hits h on h.stage_id = s.id where s.active group by s.id order by s.position`);
}

/** @deprecated use firstResponse e personVsGoal. */
export async function responseTimes(f: ReportFilter) {
  const w = periodWindow(f);
  return rows<{ userId: string | null; name: string; responses: number; avgSeconds: number; medianSeconds: number; withinGoal: number; goalSeconds: number; alerts: number }>(sql`
    with goal as (select coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60 as s),
    r as (
      select e.user_id, (e.payload->>'waitedSeconds')::int as w from deal_events e join deals d on d.id = e.deal_id
      where e.type = 'resposta' and e.created_at >= ${iso(w.from)}::timestamptz and ${dealScope(f)}
    ),
    a as (select user_id, count(*)::int as n from alerts where type = 'sem_resposta_minutos' and user_id is not null and created_at >= ${iso(w.from)}::timestamptz group by user_id)
    select r.user_id as "userId", coalesce(u.name, 'Sem responsável') as name, count(*)::int as responses,
      round(avg(r.w))::int as "avgSeconds", percentile_cont(0.5) within group (order by r.w)::int as "medianSeconds",
      count(*) filter (where r.w <= (select s from goal))::int as "withinGoal", (select s from goal)::int as "goalSeconds",
      coalesce(max(a.n), 0)::int as alerts
    from r left join users u on u.id = r.user_id left join a on a.user_id = r.user_id
    group by r.user_id, u.name order by "avgSeconds" asc`);
}

/** @deprecated use sourceToSale. Agora agrupa pela origem real ("Não identificada" no lugar de "WhatsApp"). */
export async function origins(f: ReportFilter) {
  const w = periodWindow(f);
  return rows<{ origin: string; leads: number; won: number; revenueCents: number }>(sql`
    select ${SOURCE_EXPR()} as origin, count(*)::int as leads, count(*) filter (where s.kind = 'fechado')::int as won,
      coalesce(sum(d.value_cents) filter (where s.kind = 'fechado'), 0)::bigint::int as "revenueCents"
    from deals d join stages s on s.id = d.stage_id where ${cohort(f, w)}
    group by 1 order by leads desc`);
}

/** @deprecated use lossesByReasonAndStage. */
export async function objections(f: ReportFilter) {
  const w = periodWindow(f);
  const obj = await rows<{ label: string; n: number }>(sql`
    select l.label, count(*)::int as n from deals d join lists l on l.id = d.objection_id
    where ${cohort(f, w)} group by l.label order by n desc`);
  const lost = await rows<{ label: string; n: number }>(sql`
    select l.label, count(*)::int as n from deals d join lists l on l.id = d.lost_reason_id
    where d.closed_at >= ${iso(w.from)}::timestamptz and d.closed_at <= ${iso(w.to)}::timestamptz and ${dealScope(f)} group by l.label order by n desc`);
  return { objections: obj, lostReasons: lost };
}

/** @deprecated use financeWithPaid. */
export async function finance(f: ReportFilter) {
  const w = periodWindow(f);
  const byMethod = await rows<{ method: string | null; n: number; totalCents: number }>(sql`
    select d.payment_method as method, count(*)::int as n, coalesce(sum(d.value_cents), 0)::bigint::int as "totalCents"
    from deals d join stages s on s.id = d.stage_id where s.kind = 'fechado' and d.closed_at >= ${iso(w.from)}::timestamptz and d.closed_at <= ${iso(w.to)}::timestamptz and ${dealScope(f)}
    group by d.payment_method order by "totalCents" desc`);
  const totalCents = byMethod.reduce((a, b) => a + Number(b.totalCents), 0);
  const deals = byMethod.reduce((a, b) => a + b.n, 0);
  const upcoming = await rows<{ id: string; name: string | null; phone: string; chargeAt: string; valueCents: number | null }>(sql`
    select d.id, c.name, c.phone_e164 as phone, d.charge_at as "chargeAt", d.value_cents as "valueCents"
    from deals d join contacts c on c.id = d.contact_id where d.charge_at >= ${iso(w.to)}::timestamptz and ${dealScope(f)} order by d.charge_at limit 30`);
  return { byMethod, totalCents, deals, ticketCents: deals ? Math.round(totalCents / deals) : 0, upcoming };
}

/** @deprecated use executiveNumbers. Ganhos e perdidos agora são da coorte (leads criados no período): conversão não passa de 100%. */
export async function summary(f: ReportFilter) {
  const w = periodWindow(f);
  const [r] = await rows<{ leads: number; won: number; lost: number; open: number }>(sql`
    select count(*) filter (where d.created_at >= ${iso(w.from)}::timestamptz and d.created_at <= ${iso(w.to)}::timestamptz)::int as leads,
      count(*) filter (where s.kind = 'fechado' and d.created_at >= ${iso(w.from)}::timestamptz and d.created_at <= ${iso(w.to)}::timestamptz)::int as won,
      count(*) filter (where s.kind = 'perdido' and d.created_at >= ${iso(w.from)}::timestamptz and d.created_at <= ${iso(w.to)}::timestamptz)::int as lost,
      count(*) filter (where d.closed_at is null)::int as open
    from deals d join stages s on s.id = d.stage_id where ${dealScope(f, "d", { novos: true })}`);
  return r;
}
