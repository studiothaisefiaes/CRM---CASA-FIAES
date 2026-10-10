import { and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { listTasks } from "../domain/tasks";
import { staleNow, type StaleRow } from "../reports/queries";
import { bahiaAt } from "../../lib/next-action";
import { attendanceDue, type AttendanceDue } from "./queue";
import { countLateLeads, lateDealIds } from "./late-count";

export type TodayItem = { late?: boolean; id: string; name: string | null; phone: string; stageName: string; stageKey: string; slaMinutes: number | null; at: string | null; extra?: string | null };

/** Uma próxima ação (ou retorno) da pessoa, vencida ou para hoje. `dealId` nulo: tarefa do contato, sem lead. */
export type TodayTask = { id: string; title: string; kind: string; dueAt: string; overdue: boolean; dealId: string | null; contactId: string; name: string };

const OFFSET = "interval '3 hours'"; // America/Bahia
const TASKS_LIMIT = 30;

/**
 * "Minhas próximas ações": as tarefas em aberto da pessoa que venceram ou vencem até o fim de hoje (Salvador), da mais antiga para a mais nova, ou seja,
 * vencidas primeiro. O comparecimento tem lista própria; lead arquivado e contato ignorado ficam de fora.
 */
async function myTasks(user: Pick<SessionUser, "id">, now: Date): Promise<TodayTask[]> {
  const endOfToday = new Date(bahiaAt(now.getTime(), 1, 0).getTime() - 1);
  const open = (await listTasks({ assigneeId: user.id, dueBefore: endOfToday, open: true })).filter((t) => t.kind !== "comparecimento");
  if (!open.length) return [];
  const [cs, ds] = await Promise.all([
    db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164, ignored: contacts.ignored }).from(contacts).where(inArray(contacts.id, [...new Set(open.map((t) => t.contactId))])),
    db.select({ id: deals.id, archivedAt: deals.archivedAt }).from(deals).where(and(inArray(deals.id, open.flatMap((t) => (t.dealId ? [t.dealId] : [])))))
  ]);
  const contact = new Map(cs.map((c) => [c.id, c])), deal = new Map(ds.map((d) => [d.id, d]));
  return open
    .filter((t) => !contact.get(t.contactId)?.ignored && !(t.dealId && deal.get(t.dealId)?.archivedAt))
    .slice(0, TASKS_LIMIT)
    .map((t) => ({ id: t.id, title: t.title, kind: t.kind, dueAt: t.dueAt.toISOString(), overdue: t.dueAt.getTime() < now.getTime(), dealId: t.dealId, contactId: t.contactId,
      name: contact.get(t.contactId)?.name?.trim() || contact.get(t.contactId)?.phone || "Contato" }));
}

export async function getToday(user: SessionUser, now: Date = new Date()) {
  // Fora do Hoje: lead arquivado e contato ignorado (como na Fila, no Quadro e nos Relatórios).
  const scope = user.role === "gestor" ? sql`d.archived_at is null and c.ignored = false` : sql`d.archived_at is null and c.ignored = false and (d.owner_id = ${user.id} or d.owner_id is null)`;
  const q = async (where: ReturnType<typeof sql>, at: ReturnType<typeof sql>, order: ReturnType<typeof sql>, extra = sql`null`) =>
    ((await db.execute(sql`
      select d.id, c.name, c.phone_e164 as phone, s.name as "stageName", s.key as "stageKey", s.sla_minutes as "slaMinutes", ${at} as at, ${extra} as extra
      from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
      where ${scope} and ${where} order by ${order} limit 40`)).rows as TodayItem[]).map((r) => ({ ...r, at: r.at ? new Date(r.at).toISOString() : null }));

  const todayLocal = sql`(now() - ${sql.raw(OFFSET)})::date`;
  const [waitingRows, scheduled, followups, birthdays, dues, counts, late, lateIds, tasks, attendance, stale] = await Promise.all([
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
        (select count(*)::int from alerts a where (a.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal} and a.type = 'sem_resposta_minutos' and a.user_id is not null
           ${user.role === "gestor" ? sql`` : sql`and a.user_id = ${user.id}`}) as atrasos
      from deals d join contacts c on c.id = d.contact_id where ${scope}`),
    // "Atrasado" é uma regra só (a do sino, do título da aba e da Fila): leads com alerta de espera aberto, nível 1 e 2 da mesma espera contam 1.
    countLateLeads(user),
    lateDealIds(user),
    myTasks(user, now),
    // Os agendados que já passaram do horário sem Compareceu/Faltou (ontem e os de hoje que já passaram): a mesma conferência da Fila.
    attendanceDue(user, now),
    staleNow({ now, ownerId: user.role === "gestor" ? null : user.id }),
  ]);
  const resp = (await db.execute(sql`
    select count(*)::int as n, coalesce(round(avg((e.payload->>'waitedSeconds')::int)), 0)::int as avg,
      count(*) filter (where (e.payload->>'waitedSeconds')::int <= coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60)::int as within,
      coalesce((select sla_minutes from stages where key = 'lead'), 2) * 60 as goal
    from deal_events e where e.type = 'resposta' and (e.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal}
      ${user.role === "gestor" ? sql`` : sql`and e.user_id = ${user.id}`}`)).rows[0] as { n: number; avg: number; within: number; goal: number };
  // `late` é o alerta de espera aberto (a regra do contador): só quem tem alerta fica vermelho; quem passou do prazo sem alerta (o motor ainda não rodou) fica em dourado.
  const waiting = waitingRows.map((w) => ({ ...w, late: lateIds.has(w.id) }));
  return { waiting, scheduled, followups, birthdays, dues, late, resp, tasks, attendance, stale: stale.filter((r) => r.parados > 0), counts: counts.rows[0] as { novos: number; abertos: number; atrasos: number } };
}

export type { AttendanceDue, StaleRow };
