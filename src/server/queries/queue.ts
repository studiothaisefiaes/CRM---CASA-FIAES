import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, stages, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { SOURCE_EXPR } from "../reports/common";
import { businessSecondsBetween } from "../../lib/business-hours";
import { NEAR_SLA_RATIO, SECTION_ORDER, type QueueSectionKey, type QueueView } from "../../lib/queue";
import type { QueueFilter } from "../../lib/report-links";
import { lateDealIds } from "./late-count";

export type QueueItem = {
  dealId: string; contactId: string; name: string; phone: string; hasAvatar: boolean;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null; slaMinutes: number | null;
  lastMessage: string | null; lastKind: string | null; lastDirection: "in" | "out" | null;
  stageKey: string; stageName: string; sourceLabel: string; ownerName: string | null;
  nextAction?: { title: string; dueAt: string };
  /** Etiquetas curtas: Cliente, Novo, Sem dono, Agendado hoje, Tarefa atrasada… */
  signals: string[];
};
export type QueueSection = { key: QueueSectionKey; items: QueueItem[] };
export type QueueCounts = {
  /** Leads abertos no escopo de quem pediu (não muda com busca, view ou filtro). */
  total: number; aguardando: number; atrasados: number; perto: number; agendadosHoje: number; parados: number; acoesHoje: number; tarefasAtrasadas: number;
  views: Record<QueueView, number>;
};
export type QueueResult = { sections: QueueSection[]; counts: QueueCounts };
export type QueueOptions = {
  view?: QueueView; q?: string | null; filtro?: QueueFilter | null;
  /** Só com filtro (vindo dos relatórios): pessoa, etapa e origem real. */
  dono?: string | null; etapa?: string | null; fonte?: string | null;
  now?: Date;
};

const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f-]{36}$/i;
const LIMIT = 1000;

/** Começo (00h em Salvador) do dia que contém `at`. */
const bahiaDayStart = (at: Date) => {
  const local = new Date(at.getTime() - BAHIA_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + BAHIA_OFFSET_MS;
};

type Row = {
  id: string; contactId: string; name: string | null; phone: string; hasAvatar: boolean; isClient: boolean; ownerId: string | null; ownerName: string | null;
  stageKey: string; stageName: string; slaMinutes: number | null; staleDays: number | null; stageEnteredAt: Date; awaitingReplySince: Date | null;
  scheduledAt: Date | null; createdAt: Date; sourceLabel: string; imported: boolean;
  lastMessage: string | null; lastKind: string | null; lastAt: Date | null; lastDirection: "in" | "out" | null;
  taskTitle: string | null; taskDueAt: Date | null;
};

/**
 * A Fila: os leads abertos de quem pediu, em seções por urgência. Cada lead cai em UMA seção, na primeira que valer:
 * atrasados (alerta de espera aberto, o mesmo número do sino) → perto do prazo (≥ NEAR_SLA_RATIO do prazo da etapa, em horas de expediente)
 * → aguardando resposta → próximas ações de hoje → parados (sem próxima ação e além do `stale_days` da etapa) → aguardando a cliente (o resto: a bola não está com a Casa).
 * Ninguém some: o que não é nada disso fica em "aguardando a cliente". Fora da Fila: arquivados, contatos ignorados e leads fechados/perdidos.
 * Atendente vê os leads dela e os sem dono; gestão vê todos. Com `filtro` (links dos relatórios), atendente vê só os dela, como nos relatórios.
 */
export async function getQueue(user: Pick<SessionUser, "id" | "role">, opts: QueueOptions = {}): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  const gestor = user.role === "gestor";
  const [hours, lateIds] = await Promise.all([getBusinessHours(), lateDealIds(user)]);

  const conds = [isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false)];
  if (!gestor) conds.push(opts.filtro ? eq(deals.ownerId, user.id) : sql`(${deals.ownerId} = ${user.id} or ${deals.ownerId} is null)`);
  else if (opts.filtro && opts.dono && UUID.test(opts.dono)) conds.push(eq(deals.ownerId, opts.dono));
  if (opts.etapa && /^[a-z0-9_]{1,40}$/i.test(opts.etapa)) conds.push(eq(stages.key, opts.etapa));
  if (opts.fonte) conds.push(sql`${SOURCE_EXPR("deals")} = ${opts.fonte}`);

  const rows = await db.select({
    id: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`,
    isClient: contacts.isClient, ownerId: deals.ownerId, ownerName: users.name,
    stageKey: stages.key, stageName: stages.name, slaMinutes: stages.slaMinutes, staleDays: stages.staleDays,
    stageEnteredAt: deals.stageEnteredAt, awaitingReplySince: deals.awaitingReplySince, scheduledAt: deals.scheduledAt, createdAt: deals.createdAt,
    sourceLabel: sql<string>`${SOURCE_EXPR("deals")}`,
    imported: sql<boolean>`exists (select 1 from deal_events he where he.deal_id = ${deals.id} and he.type = 'lead_criado' and he.payload->>'historico' = 'true')`,
    lastMessage: sql<string | null>`lm.body`, lastKind: sql<string | null>`lm.kind`, lastAt: sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
    taskTitle: sql<string | null>`nt.title`, taskDueAt: sql<Date | null>`nt.due_at`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.body, m.kind, m.created_at, m.direction from messages m where m.deal_id = ${deals.id} order by m.created_at desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral (select t.title, t.due_at from tasks t where t.deal_id = ${deals.id} and t.done_at is null and t.kind in ('proxima_acao', 'retorno', 'comparecimento') order by t.due_at asc limit 1) nt`, sql`true`)
    .where(and(...conds))
    .orderBy(asc(deals.awaitingReplySince), asc(deals.createdAt))
    .limit(LIMIT) as unknown as Row[];

  const nowMs = now.getTime();
  const today0 = bahiaDayStart(now), today1 = today0 + DAY_MS, tomorrow1 = today1 + DAY_MS;
  const ninety = nowMs - 90 * DAY_MS;
  const within = (d: Date | null, from: number, to: number) => !!d && d.getTime() >= from && d.getTime() < to;

  type Entry = { item: QueueItem; section: QueueSectionKey; row: Row; waitSec: number; stale: boolean; scheduledToday: boolean; scheduledTomorrow: boolean; overdueTask: boolean; noContact90: boolean; isNew: boolean };
  const entries: Entry[] = rows.map((r) => {
    const awaiting = r.awaitingReplySince;
    const waitSec = awaiting ? businessSecondsBetween(awaiting.getTime(), nowMs, hours) : 0;
    const late = lateIds.has(r.id);
    const near = !late && !!awaiting && !!r.slaMinutes && waitSec >= r.slaMinutes * 60 * NEAR_SLA_RATIO;
    const taskDue = r.taskDueAt ? new Date(r.taskDueAt) : null;
    const actionToday = !!taskDue && taskDue.getTime() < today1;
    const stale = r.staleDays != null && r.stageEnteredAt.getTime() <= nowMs - r.staleDays * DAY_MS;
    const section: QueueSectionKey = late ? "atrasados" : near ? "perto" : awaiting ? "aguardando" : actionToday ? "acoes-hoje" : stale && !taskDue ? "parados" : "aguardando-cliente";
    const scheduledToday = within(r.scheduledAt, today0, today1);
    const scheduledTomorrow = within(r.scheduledAt, today1, tomorrow1);
    const overdueTask = !!taskDue && taskDue.getTime() < nowMs;
    const isNew = !r.imported && within(r.createdAt, today0, today1);
    const signals = [
      ...(r.isClient ? ["Cliente"] : []), ...(isNew ? ["Novo"] : []), ...(r.ownerId ? [] : ["Sem dono"]),
      ...(scheduledToday ? ["Agendado hoje"] : scheduledTomorrow ? ["Agendado amanhã"] : []), ...(overdueTask ? ["Tarefa atrasada"] : []),
      ...(stale && !taskDue && section !== "parados" ? ["Parado"] : []),
    ];
    const item: QueueItem = {
      dealId: r.id, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: r.hasAvatar,
      awaitingSince: awaiting ? awaiting.toISOString() : null, slaMinutes: r.slaMinutes,
      lastMessage: r.lastMessage, lastKind: r.lastKind, lastDirection: r.lastDirection,
      stageKey: r.stageKey, stageName: r.stageName, sourceLabel: r.sourceLabel, ownerName: r.ownerName,
      ...(taskDue && r.taskTitle ? { nextAction: { title: r.taskTitle, dueAt: taskDue.toISOString() } } : {}),
      signals,
    };
    const lastContact = r.lastAt ? new Date(r.lastAt).getTime() : r.createdAt.getTime();
    return { item, section, row: r, waitSec, stale, scheduledToday, scheduledTomorrow, overdueTask, noContact90: lastContact < ninety, isNew };
  });

  const count = (f: (e: Entry) => boolean) => entries.filter(f).length;
  const viewTest: Record<QueueView, (e: Entry) => boolean> = {
    todos: () => true,
    meus: (e) => e.row.ownerId === user.id,
    "sem-dono": (e) => e.row.ownerId === null,
    parados: (e) => e.stale,
    "agendados-hoje": (e) => e.scheduledToday,
    "clientes-ativos": (e) => e.row.isClient,
    "sem-contato-90d": (e) => e.noContact90,
  };
  const counts: QueueCounts = {
    total: entries.length,
    aguardando: count((e) => e.row.awaitingReplySince !== null),
    atrasados: count((e) => e.section === "atrasados"),
    perto: count((e) => e.section === "perto"),
    agendadosHoje: count((e) => e.scheduledToday),
    parados: count((e) => e.stale),
    acoesHoje: count((e) => e.section === "acoes-hoje"),
    tarefasAtrasadas: count((e) => e.overdueTask),
    views: Object.fromEntries((Object.keys(viewTest) as QueueView[]).map((v) => [v, count(viewTest[v])])) as Record<QueueView, number>,
  };

  const filterTest: Record<QueueFilter, (e: Entry) => boolean> = {
    atrasados: (e) => e.section === "atrasados",
    esperando: (e) => e.row.awaitingReplySince !== null,
    parados: (e) => e.stale,
    "tarefas-atrasadas": (e) => e.overdueTask,
    "agendados-amanha": (e) => e.scheduledTomorrow,
    novos: (e) => e.isNew,
  };
  const term = opts.q?.trim().toLowerCase() ?? "";
  const digits = (opts.q ?? "").replace(/\D/g, "");
  const wanted = entries.filter((e) =>
    viewTest[opts.view ?? "todos"](e) && (!opts.filtro || filterTest[opts.filtro](e))
    && (!term || (e.row.name ?? "").toLowerCase().includes(term) || (digits.length >= 3 && e.row.phone.replace(/\D/g, "").includes(digits))));

  // Dentro da seção: quem espera há mais tempo primeiro; ações pelo vencimento; parados pelo mais antigo; o resto pela conversa mais recente.
  const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
  const order: Record<QueueSectionKey, (a: Entry, b: Entry) => number> = {
    atrasados: (a, b) => b.waitSec - a.waitSec, perto: (a, b) => b.waitSec - a.waitSec, aguardando: (a, b) => b.waitSec - a.waitSec,
    "acoes-hoje": (a, b) => time(a.row.taskDueAt) - time(b.row.taskDueAt),
    parados: (a, b) => time(a.row.stageEnteredAt) - time(b.row.stageEnteredAt),
    "aguardando-cliente": (a, b) => time(b.row.lastAt) - time(a.row.lastAt),
  };
  const sections = SECTION_ORDER.flatMap((key) => {
    const items = wanted.filter((e) => e.section === key).sort(order[key]).map((e) => e.item);
    return items.length ? [{ key, items }] : [];
  });
  return { sections, counts };
}
