import { genericClientSql } from "@/lib/generic-client";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { db } from "../db";
import { appointments, contacts, deals, professionals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { listTasks } from "../domain/tasks";
import { staleNow, type StaleRow } from "../reports/queries";
import { bahiaAt, answeredAfterDue } from "../../lib/next-action";
import { attendanceDue, type AttendanceDue } from "./queue";
import { countLateLeads, lateDealIds } from "./late-count";
import { clientLabel } from "../../lib/alert-copy";
import { currentOf, inHouseVisits, NA_CASA_LOOKUP_STATUSES } from "../../lib/na-casa";
import { agendaRange } from "../../lib/agenda";
import { VIEW_STATUS, viewStatus, type ViewStatus } from "../../lib/agenda-day";
import { displayName } from "../../lib/display-name";
import { leadHref } from "../../lib/lead-href";
import { getAgenda } from "./agenda";
import { getCaixaMode } from "../domain/caixa/mode";

export type TodayItem = { late?: boolean; id: string; contactId: string; /** A dona da conversa (null: sem dono). */ ownerId?: string | null; name: string | null; phone: string; stageName: string; stageKey: string; slaMinutes: number | null; at: string | null; extra?: string | null };

/** Uma próxima ação (ou retorno) da pessoa, vencida ou para hoje. `dealId` nulo: tarefa do contato, sem lead. */
export type TodayTask = { id: string; title: string; kind: string; dueAt: string; overdue: boolean; dealId: string | null; contactId: string; name: string; /** O telefone da cliente (para `hidePhone` no título). */ phone?: string | null;
  /** Vencido e a Casa já escreveu depois: a tela sugere "Marcar como feito". */ answeredAfter?: boolean };

const OFFSET = "interval '3 hours'"; // America/Bahia
const TASKS_LIMIT = 30;
/** O combinado que o pedido "Preciso remarcar" do link cria (`requestRescheduleByLink`). */
const LINK_REQUEST_TITLE = "Remarcar (pediu pelo link)";

/**
 * Próximas ações vencidas ou para hoje (Salvador), da mais antiga para a mais nova (vencidas primeiro): as da pessoa ("Minhas") ou as sem
 * responsável (aba da gestão). O comparecimento tem lista própria; lead arquivado e contato ignorado ficam de fora.
 */
async function tasksOf(filter: { assigneeId: string } | { unassigned: true }, now: Date): Promise<TodayTask[]> {
  const endOfToday = new Date(bahiaAt(now.getTime(), 1, 0).getTime() - 1);
  const open = (await listTasks({ ...filter, dueBefore: endOfToday, open: true })).filter((t) => t.kind !== "comparecimento");
  if (!open.length) return [];
  const [cs, ds] = await Promise.all([
    db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164, ignored: contacts.ignored }).from(contacts).where(inArray(contacts.id, [...new Set(open.map((t) => t.contactId))])),
    db.select({ id: deals.id, archivedAt: deals.archivedAt, lastOutboundAt: deals.lastOutboundAt }).from(deals).where(and(inArray(deals.id, open.flatMap((t) => (t.dealId ? [t.dealId] : []))))),
  ]);
  const contact = new Map(cs.map((c) => [c.id, c])), deal = new Map(ds.map((d) => [d.id, d]));
  // Psico r68 #10: pedido da cliente (link) primeiro e os vencidos há mais de 7 dias por último, para 30 antigos não enterrarem o que ela pediu hoje.
  const STALE_MS = 7 * 86_400_000;
  const rank = (t: (typeof open)[number]) => (t.title.startsWith(LINK_REQUEST_TITLE) ? 0 : now.getTime() - t.dueAt.getTime() > STALE_MS ? 2 : 1);
  return open
    .filter((t) => !contact.get(t.contactId)?.ignored && !(t.dealId && deal.get(t.dealId)?.archivedAt))
    .map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t)
    .slice(0, TASKS_LIMIT)
    .map((t) => {
      const c = contact.get(t.contactId);
      return { id: t.id, title: t.title, kind: t.kind, dueAt: t.dueAt.toISOString(), overdue: t.dueAt.getTime() < now.getTime(), dealId: t.dealId, contactId: t.contactId,
        name: c ? clientLabel(c.name, c.phone) : "Contato", phone: c?.phone ?? null,
        answeredAfter: answeredAfterDue(t.dueAt.getTime(), t.dealId ? deal.get(t.dealId)?.lastOutboundAt?.getTime() : null, now.getTime()) };
    });
}

export type TodayBirthday = { contactId: string; dealId: string | null; name: string; label: string; today: boolean;
  /** Fiel (3+ visitas) ou recente (visita nos últimos 90 dias): vem primeiro no dia. */ loyal: boolean; hasAvatar: boolean };
/** "Aniversário hoje" no topo do Hoje: fiéis e recentes primeiro (pedido do dono, 15/10). */
const LOYAL_VISITS = 3, RECENT_DAYS = 90;
const pad2 = (n: number) => String(n).padStart(2, "0");
/**
 * Aniversários dos próximos 7 dias (hoje incluído), de TODOS os contatos (não exige lead), no dia certo: compara dia e mês de cada um dos
 * 8 dias, então 29, 30 e 31 caem no próprio dia. Quem nasceu em 29/02 comemora no 28/02 em ano não bissexto. Atendente não vê quem tem
 * conversa aberta com outra dona. O link vai para o lead mais recente, ou para a ficha quando não há lead.
 */
async function birthdaysOf(user: Pick<SessionUser, "id">, all: boolean, now: Date): Promise<TodayBirthday[]> {
  const day0 = sql`(${now.toISOString()}::timestamptz - ${sql.raw(OFFSET)})::date`;
  const rows = (await db.execute(sql`
    with dias as (select (${day0} + g)::date as dia, g from generate_series(0, 7) g)
    select c.id as "contactId", c.name, c.phone_e164 as phone, c.birth_day as day, c.birth_month as month, min(dias.g)::int as "in_days",
      (c.avatar_path is not null) as "hasAvatar",
      bool_or(coalesce(st.visits, 0) >= ${LOYAL_VISITS} or (st.last_visit_on is not null and st.last_visit_on >= ${day0} - ${RECENT_DAYS}::int)) as loyal,
      (select d.id from deals d where d.contact_id = c.id and d.archived_at is null order by d.closed_at nulls first, d.created_at desc limit 1) as "dealId"
    from contacts c
    left join contact_stats st on st.contact_id = c.id
    join dias on extract(month from dias.dia)::int = c.birth_month and (
      extract(day from dias.dia)::int = c.birth_day
      or (c.birth_month = 2 and c.birth_day = 29 and extract(day from dias.dia)::int = 28
          and extract(day from (date_trunc('year', dias.dia) + interval '1 month 28 days'))::int <> 29))
    where c.kind = 'cliente'
      ${all ? sql`` : sql`and not exists (select 1 from deals o where o.contact_id = c.id and o.archived_at is null and o.closed_at is null and o.owner_id is not null and o.owner_id <> ${user.id})`}
    group by c.id
    order by min(dias.g), loyal desc, c.name
    limit 200`)).rows as { contactId: string; name: string | null; phone: string; day: number; month: number; in_days: number; dealId: string | null; loyal: boolean; hasAvatar: boolean }[];
  return rows.map((r) => ({ contactId: r.contactId, dealId: r.dealId, name: clientLabel(r.name, r.phone), label: `${pad2(r.day)}/${pad2(r.month)}`, today: r.in_days === 0,
    loyal: !!r.loyal, hasAvatar: !!r.hasAvatar }));
}

/** "Na Casa agora" no Hoje: uma linha por visita em andamento. `since` é a chegada (ou o início); `started` = em atendimento agora. */
export type TodayInHouse = { key: string; contactId: string | null; dealId: string | null; name: string; hasAvatar: boolean; service: string; professional: string | null;
  since: string; started: boolean };

/**
 * Quem está no salão agora (pedido do dono, 15/10), pela mesma regra da etapa Na Casa (`lib/na-casa`), de todas as clientes do dia
 * (não só de quem tem conversa): Chegou, Em atendimento ou entre dois serviços da visita. Gêmeo do Avec e "Não é cliente" ficam de fora.
 */
async function inHouseOf(now: Date): Promise<TodayInHouse[]> {
  const rows = await db.select({
    id: appointments.id, visitId: appointments.visitId, status: appointments.status, startsAt: appointments.startsAt, arrivedAt: appointments.arrivedAt,
    startedAt: appointments.startedAt, service: appointments.serviceLabel, professional: professionals.name, contactId: appointments.contactId,
    clientName: appointments.clientName, name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`${contacts.avatarPath} is not null`,
    ignored: contacts.ignored,
    dealId: sql<string | null>`(select d.id from deals d where d.contact_id = ${appointments.contactId} and d.closed_at is null and d.archived_at is null order by d.created_at desc limit 1)`,
  }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(isNull(appointments.avecTwinOf), inArray(appointments.status, NA_CASA_LOOKUP_STATUSES), sql`not ${genericClientSql(appointments, contacts.name)}`,
      gte(appointments.startsAt, new Date(now.getTime() - 86_400_000)), lte(appointments.startsAt, new Date(now.getTime() + 86_400_000))));
  return inHouseVisits(rows.filter((r) => !r.ignored), now).map((v) => {
    const cur = currentOf(v);
    const stamps = v.flatMap((a) => [a.arrivedAt, a.startedAt]).filter((x): x is Date => !!x).map((x) => x.getTime());
    return {
      key: cur.visitId ?? cur.id, contactId: cur.contactId, dealId: cur.dealId, hasAvatar: !!cur.hasAvatar,
      name: cur.contactId ? clientLabel(cur.name, cur.phone ?? "") : cur.clientName?.trim() || "Cliente",
      service: cur.service, professional: cur.professional ?? null,
      since: new Date(stamps.length ? Math.min(...stamps) : v[0].startsAt.getTime()).toISOString(), started: cur.status === "em_atendimento",
    };
  }).sort((a, b) => a.since.localeCompare(b.since));
}

/** Uma linha da "Agenda de hoje" no Hoje: o horário, quem é, com quem e em que pé está. `href` abre o horário na Agenda. */
export type TodayAgendaItem = { key: string; appointmentId: string | null; dealId: string | null; name: string; at: string; noTime: boolean;
  professional: string | null; service: string | null; state: ViewStatus; stateLabel: string; href: string };

/**
 * "Agenda de hoje" (P1, 17/10): os horários de hoje da Agenda, pela mesma consulta da tela Agenda (`getAgenda`) e a mesma regra da grade
 * (cancelado fica de fora; gêmeo do Avec, lista de espera, lead arquivado e contato ignorado a consulta já tira). Antes contava
 * `deals.scheduled_at` (o funil) e mostrava 17 de 54. O estado é o da cor do cartão na grade (`viewStatus`).
 */
async function todayAgendaOf(now: Date): Promise<TodayAgendaItem[]> {
  const [items, caixa] = await Promise.all([getAgenda(agendaRange({}, now), now), getCaixaMode()]);
  return items.filter((i) => i.status !== "cancelado" && !i.genericClient && i.dbStatus !== "conferir").map((i) => {
    const state = viewStatus(i, now.getTime(), { caixaOn: caixa === "crm" });
    return {
      key: i.key, appointmentId: i.appointmentId, dealId: i.dealId, name: displayName(i.name), at: i.scheduledAt, noTime: i.noTime,
      professional: i.professionalName, service: i.service ? displayName(i.service) : null, state, stateLabel: VIEW_STATUS[state].label,
      href: i.appointmentId ? `/agenda?destaque=${i.appointmentId}` : leadHref(i.dealId),
    };
  });
}

export async function getToday(user: SessionUser, now: Date = new Date()) {
  // Fora do Hoje: lead arquivado e contato ignorado (como na Fila, no Quadro e nos Relatórios).
  const all = can(user.perms, "atendimento.todas");
  const scope = all ? sql`d.archived_at is null and c.kind = 'cliente'` : sql`d.archived_at is null and c.kind = 'cliente' and (d.owner_id = ${user.id} or d.owner_id is null)`;
  const q = async (where: ReturnType<typeof sql>, at: ReturnType<typeof sql>, order: ReturnType<typeof sql>, extra = sql`null`) =>
    ((await db.execute(sql`
      select d.id, c.id as "contactId", d.owner_id as "ownerId", c.name, c.phone_e164 as phone, s.name as "stageName", s.key as "stageKey", s.sla_minutes as "slaMinutes", ${at} as at, ${extra} as extra
      from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
      where ${scope} and ${where} order by ${order} limit 40`)).rows as TodayItem[]).map((r) => ({ ...r, at: r.at ? new Date(r.at).toISOString() : null }));

  const todayLocal = sql`(now() - ${sql.raw(OFFSET)})::date`;
  const [waitingRows, agenda, followups, dues, counts, late, lateIds, tasks, attendance, stale, birthdays, unassigned, naCasa] = await Promise.all([
    q(sql`d.closed_at is null and d.awaiting_reply_since is not null`, sql`d.awaiting_reply_since`, sql`d.awaiting_reply_since asc`),
    todayAgendaOf(now),
    q(sql`d.closed_at is null and (s.kind in ('followup', 'proposta') or (s.kind = 'atendimento' and d.followup_attempt > 0))`, sql`d.stage_entered_at`, sql`s.position desc, d.stage_entered_at asc`),
    q(sql`(((d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal}) or ((d.recontact_at - ${sql.raw(OFFSET)})::date = ${todayLocal}))`,
      sql`case when (d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal} then d.charge_at else d.recontact_at end`, sql`2`, sql`case when (d.charge_at - ${sql.raw(OFFSET)})::date = ${todayLocal} then 'Cobrança' else 'Recontato' end`),
    db.execute(sql`select
        count(*) filter (where (d.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal})::int as novos,
        count(*) filter (where d.closed_at is null)::int as abertos,
        (select count(*)::int from alerts a where (a.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal} and a.type = 'sem_resposta_minutos' and a.user_id is not null
           ${all ? sql`` : sql`and a.user_id = ${user.id}`}) as atrasos
      from deals d join contacts c on c.id = d.contact_id where ${scope}`),
    // "Atrasado" é uma regra só (a do sino, do título da aba e da Fila): leads com alerta de espera aberto, nível 1 e 2 da mesma espera contam 1.
    countLateLeads(user),
    lateDealIds(user),
    tasksOf({ assigneeId: user.id }, now),
    // Os agendados que já passaram do horário sem Compareceu/Faltou (ontem e os de hoje que já passaram): a mesma conferência da Fila.
    attendanceDue(user, now),
    staleNow({ now, ownerId: all ? null : user.id }),
    birthdaysOf(user, all, now),
    // A aba "Sem responsável" é só da gestão: para a atendente, null (não lista vazia).
    all ? tasksOf({ unassigned: true }, now) : Promise.resolve(null),
    inHouseOf(now),
  ]);
  const resp = (await db.execute(sql`
    select count(*)::int as n, coalesce(round(avg((e.payload->>'waitedSeconds')::int)), 0)::int as avg,
      count(*) filter (where (e.payload->>'waitedSeconds')::int <= coalesce((select sla_minutes from stages where kind = 'lead' and active order by position limit 1), 2) * 60)::int as within,
      coalesce((select sla_minutes from stages where kind = 'lead' and active order by position limit 1), 2) * 60 as goal
    from deal_events e where e.type = 'resposta' and (e.created_at - ${sql.raw(OFFSET)})::date = ${todayLocal}
      ${all ? sql`` : sql`and e.user_id = ${user.id}`}`)).rows[0] as { n: number; avg: number; within: number; goal: number };
  // `late` é o alerta de espera aberto (a regra do contador): só quem tem alerta fica vermelho; quem passou do prazo sem alerta (o motor ainda não rodou) fica em dourado.
  const waiting = waitingRows.map((w) => ({ ...w, late: lateIds.has(w.id) }));
  // "Para você agora" (Hoje v3): só as conversas em que a pessoa é a dona; a equipe toda fica em Esperando resposta.
  const waitingMine = waiting.filter((w) => w.ownerId === user.id);
  return { waiting, waitingMine, agenda, followups, birthdays, naCasa, dues, late, resp, tasks, unassigned, attendance, stale: stale.filter((r) => r.parados > 0), counts: counts.rows[0] as { novos: number; abertos: number; atrasos: number } };
}

export type { AttendanceDue, StaleRow };
