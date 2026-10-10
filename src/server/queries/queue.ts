import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, stages, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { SOURCE_EXPR } from "../reports/common";
import { businessSecondsBetween } from "../../lib/business-hours";
import { NEAR_SLA_RATIO, SECTION_ORDER, type QueueFoco, type QueueSectionKey, type QueueView } from "../../lib/queue";
import type { QueueFilter } from "../../lib/report-links";
import { lateDealIds } from "./late-count";
import { isUuid } from "../../lib/uuid";

export type QueueItem = {
  dealId: string; contactId: string; name: string; phone: string; hasAvatar: boolean;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null; slaMinutes: number | null;
  lastMessage: string | null; lastKind: string | null; lastDirection: "in" | "out" | null;
  /** Última mensagem do lead (ISO); em "Para reengajar", a última do contato. */
  lastAt: string | null;
  stageKey: string; stageName: string; sourceLabel: string; ownerName: string | null;
  nextAction?: { title: string; dueAt: string };
  /** Etiquetas curtas: Cliente, Novo, Sem dono, Agendado hoje, Tarefa atrasada… */
  signals: string[];
};
export type QueueSection = { key: QueueSectionKey; items: QueueItem[] };
export type QueueCounts = {
  /** Leads abertos no escopo de quem pediu (não muda com busca, view, filtro nem limite). */
  total: number; aguardando: number; atrasados: number; perto: number; agendadosHoje: number; parados: number; acoesHoje: number; tarefasAtrasadas: number;
  views: Record<QueueView, number>;
};
/** Agendado cujo horário já passou e ainda sem "Compareceu"/"Faltou": a conferência do dia. */
export type AttendanceDue = { dealId: string; contactId: string; name: string; phone: string; hasAvatar: boolean; scheduledAt: string; ownerName: string | null };
export type QueueResult = {
  sections: QueueSection[]; counts: QueueCounts; /** Preenchido quando o limite cortou a lista. */ truncated: { shown: number; total: number } | null;
  /** Leads Agendados com o horário vencido, para conferir o comparecimento (fora do listbox da Fila). */
  conferir: AttendanceDue[];
};
export type QueueOptions = {
  view?: QueueView;
  /** Chips do resumo: mesmo escopo dos `counts`. */
  foco?: QueueFoco | null;
  q?: string | null;
  /** Links dos relatórios (drill-down): a atendente vê só os dela, e valem pessoa, etapa e origem real. */
  filtro?: QueueFilter | null;
  dono?: string | null; etapa?: string | null; fonte?: string | null;
  now?: Date;
  /** Máximo de leads devolvidos (os `counts` valem para todos). */
  limit?: number;
};

export const QUEUE_LIMIT = 1000;
const ETAPA_KEY = /^[a-z0-9_]{1,40}$/i;
/** `etapa=followup` (a estação "Follow-up" da Jornada) é Follow-up 1 a 4 juntos, como na coluna do Quadro. */
export const FOLLOWUP_STATION = "followup";

/** O nome da etapa do `?etapa=`, para o aviso "Mostrando: etapa Lead" da Fila. Chave que não existe: null (o filtro não acha ninguém, o aviso não mente). */
export async function queueStageLabel(etapa: string | null | undefined): Promise<string | null> {
  if (!etapa || !ETAPA_KEY.test(etapa)) return null;
  if (etapa === FOLLOWUP_STATION) return "Follow-up";
  const [s] = await db.select({ name: stages.name }).from(stages).where(eq(stages.key, etapa)).limit(1);
  return s?.name ?? null;
}
const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;

/** Começo (00h em Salvador) do dia que contém `at`. */
const bahiaDayStart = (at: Date) => {
  const local = new Date(at.getTime() - BAHIA_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + BAHIA_OFFSET_MS;
};

type Who = Pick<SessionUser, "id" | "role">;
/** Atendente vê os leads dela e os sem dono; gestão vê todos. */
const scopeCond = (user: Who, onlyOwn = false): SQL | null =>
  user.role === "gestor" ? null : onlyOwn ? eq(deals.ownerId, user.id) : sql`(${deals.ownerId} = ${user.id} or ${deals.ownerId} is null)`;

/** Primeira fase: só o que a classificação e os números precisam (sem texto de mensagem), para todos os leads do escopo. */
type Light = {
  id: string; contactId: string; name: string | null; phone: string; isClient: boolean; ownerId: string | null; ownerName: string | null;
  stageKey: string; stageName: string; slaMinutes: number | null; staleDays: number | null; stageEnteredAt: Date; awaitingReplySince: Date | null;
  scheduledAt: Date | null; createdAt: Date; imported: boolean; lastAt: Date | null; lastDirection: "in" | "out" | null; taskDueAt: Date | null;
};
const LAST_OF_CONTACT = sql`(select max(m2.created_at) from messages m2 where m2.contact_id = ${contacts.id})`;

async function lightRows(conds: SQL[], opts: { lastOfContact?: boolean; limit?: number } = {}): Promise<Light[]> {
  const q = db.select({
    id: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, isClient: contacts.isClient, ownerId: deals.ownerId, ownerName: users.name,
    stageKey: stages.key, stageName: stages.name, slaMinutes: stages.slaMinutes, staleDays: stages.staleDays,
    stageEnteredAt: deals.stageEnteredAt, awaitingReplySince: deals.awaitingReplySince, scheduledAt: deals.scheduledAt, createdAt: deals.createdAt,
    imported: sql<boolean>`exists (select 1 from deal_events he where he.deal_id = ${deals.id} and he.type = 'lead_criado' and he.payload->>'historico' = 'true')`,
    lastAt: opts.lastOfContact ? sql<Date | null>`${LAST_OF_CONTACT}` : sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
    taskDueAt: sql<Date | null>`nt.due_at`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.created_at, m.direction from messages m where m.deal_id = ${deals.id} order by m.created_at desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral (select t.due_at from tasks t where t.deal_id = ${deals.id} and t.done_at is null and t.kind in ('proxima_acao', 'retorno', 'comparecimento') order by t.due_at asc limit 1) nt`, sql`true`)
    .where(and(...conds))
    .orderBy(asc(deals.awaitingReplySince), asc(deals.createdAt));
  return (opts.limit ? await q.limit(opts.limit) : await q) as unknown as Light[];
}

/** Segunda fase: o texto (última mensagem, título da próxima ação, origem, foto) só dos leads que vão para a tela. */
async function details(ids: string[]) {
  if (!ids.length) return new Map<string, { hasAvatar: boolean; sourceLabel: string; lastMessage: string | null; lastKind: string | null; taskTitle: string | null }>();
  const rows = await db.select({
    id: deals.id, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, sourceLabel: sql<string>`${SOURCE_EXPR("deals")}`,
    lastMessage: sql<string | null>`lm.body`, lastKind: sql<string | null>`lm.kind`, taskTitle: sql<string | null>`nt.title`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(sql`lateral (select m.body, m.kind from messages m where m.deal_id = ${deals.id} order by m.created_at desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral (select t.title from tasks t where t.deal_id = ${deals.id} and t.done_at is null and t.kind in ('proxima_acao', 'retorno', 'comparecimento') order by t.due_at asc limit 1) nt`, sql`true`)
    .where(inArray(deals.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export const ATTENDANCE_DUE_LIMIT = 20;

/**
 * A conferência de comparecimento: leads em Agendado cujo horário já passou e que ainda não têm Compareceu/Faltou ("confirmado" pela enquete conta como
 * não conferido). Mesmo escopo da Fila (atendente vê os dela e os sem dono); o mais antigo primeiro.
 */
export async function attendanceDue(user: Who, now: Date, opts: { mine?: boolean; limit?: number } = {}): Promise<AttendanceDue[]> {
  const sc = scopeCond(user);
  const rows = await db.select({ dealId: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, scheduledAt: deals.scheduledAt, ownerName: users.name })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(users, eq(users.id, deals.ownerId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false), eq(stages.kind, "agendado"), ...(opts.mine ? [eq(deals.ownerId, user.id)] : []),
      sql`${deals.scheduledAt} <= ${now.toISOString()}::timestamptz`, sql`(${deals.attendance} is null or ${deals.attendance} = 'confirmado')`, ...(sc ? [sc] : [])))
    .orderBy(asc(deals.scheduledAt)).limit(opts.limit ?? ATTENDANCE_DUE_LIMIT);
  return rows.map((r) => ({ dealId: r.dealId, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: r.hasAvatar, scheduledAt: new Date(r.scheduledAt!).toISOString(), ownerName: r.ownerName }));
}

/** Opções da barra de ações em massa: as etapas sem diálogo e, para a gestão, as pessoas da equipe. */
export type BulkOptions = { stages: { key: string; name: string }[]; people: { id: string; name: string }[]; canAssign: boolean };
export async function getBulkOptions(user: Who): Promise<BulkOptions> {
  const [stageRows, people] = await Promise.all([
    db.select({ key: stages.key, name: stages.name }).from(stages).where(and(eq(stages.active, true), inArray(stages.kind, ["lead", "atendimento", "followup"]))).orderBy(asc(stages.position)),
    user.role === "gestor" ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)) : Promise.resolve([]),
  ]);
  return { stages: stageRows, people, canAssign: user.role === "gestor" };
}

/**
 * "Sem contato há 90 dias": contatos para reengajar. Vale o ÚLTIMO lead do contato (aberto ou fechado, não arquivado), contato não ignorado,
 * cuja última mensagem do contato (ou a criação do lead, o que for mais recente) passou de 90 dias.
 */
const reengageConds = (user: Who, now: Date): SQL[] => [
  isNull(deals.archivedAt), eq(contacts.ignored, false),
  sql`${deals.id} = (select d2.id from deals d2 where d2.contact_id = ${contacts.id} and d2.archived_at is null order by d2.created_at desc limit 1)`,
  sql`greatest(coalesce(${LAST_OF_CONTACT}, ${deals.createdAt}), ${deals.createdAt}) < ${new Date(now.getTime() - 90 * DAY_MS).toISOString()}::timestamptz`,
  ...(scopeCond(user) ? [scopeCond(user)!] : []),
];

const qCond = (q: string): SQL => {
  const like = `%${q.trim().toLowerCase()}%`;
  const digits = q.replace(/\D/g, "");
  return sql`(lower(coalesce(${contacts.name}, '')) like ${like} or ${digits.length >= 3 ? sql`${contacts.phoneE164} like ${"%" + digits + "%"}` : sql`false`})`;
};

/**
 * A Fila: os leads abertos de quem pediu, em seções por urgência. Cada lead cai em UMA seção, na primeira que valer:
 * atrasados (alerta de espera aberto, a mesma condição do sino) → perto do prazo (≥ NEAR_SLA_RATIO do prazo da etapa, em horas de expediente)
 * → aguardando resposta → próximas ações de hoje → parados (sem próxima ação e além do `stale_days` da etapa) → aguardando a cliente (o resto: a bola não está com a Casa).
 * Ninguém some: o que não é nada disso fica em "aguardando a cliente". Fora da Fila: arquivados, contatos ignorados e leads fechados/perdidos.
 * A view "Sem contato há 90 dias" é outra lista: contatos para reengajar (ver `reengageConds`).
 * Atendente vê os leads dela e os sem dono; gestão vê todos. Com `filtro` (links dos relatórios), atendente vê só os dela, como nos relatórios.
 * Os `counts` valem para todos os leads do escopo, mesmo quando `limit` corta a lista (`truncated`).
 */
export async function getQueue(user: Who, opts: QueueOptions = {}): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? QUEUE_LIMIT;
  const gestor = user.role === "gestor";
  const onlyOwn = !gestor && !!opts.filtro; // "só os seus" vale só para o link vindo de relatório
  const [hours, lateIds] = await Promise.all([getBusinessHours(), lateDealIds(user, { onlyOwn })]);

  const conds: SQL[] = [isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false)];
  const sc = scopeCond(user, onlyOwn);
  if (sc) conds.push(sc);
  if (gestor && opts.filtro && opts.dono && isUuid(opts.dono)) conds.push(eq(deals.ownerId, opts.dono));
  if (opts.etapa && ETAPA_KEY.test(opts.etapa)) conds.push(opts.etapa === FOLLOWUP_STATION ? eq(stages.kind, "followup") : eq(stages.key, opts.etapa));
  if (opts.fonte) conds.push(sql`${SOURCE_EXPR("deals")} = ${opts.fonte}`);

  const reengage = opts.view === "sem-contato-90d";
  const [rows, [reengageCount], reengageRows] = await Promise.all([
    lightRows(conds),
    db.select({ n: sql<number>`count(*)::int` }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(...reengageConds(user, now))),
    reengage ? lightRows([...reengageConds(user, now), ...(opts.q?.trim() ? [qCond(opts.q)] : [])], { lastOfContact: true }) : Promise.resolve([] as Light[]),
  ]);

  const nowMs = now.getTime();
  const today0 = bahiaDayStart(now), today1 = today0 + DAY_MS, tomorrow1 = today1 + DAY_MS;
  const within = (d: Date | null, from: number, to: number) => !!d && new Date(d).getTime() >= from && new Date(d).getTime() < to;
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

  type Entry = { r: Light; section: QueueSectionKey; waitSec: number; stale: boolean; scheduledToday: boolean; scheduledTomorrow: boolean; overdueTask: boolean; noContact90: boolean; isNew: boolean; signals: string[] };
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
    return { r, section, waitSec, stale, scheduledToday, scheduledTomorrow, overdueTask, noContact90: false, isNew, signals };
  });

  const count = (f: (e: Entry) => boolean) => entries.filter(f).length;
  const viewTest: Record<Exclude<QueueView, "sem-contato-90d">, (e: Entry) => boolean> = {
    todos: () => true,
    meus: (e) => e.r.ownerId === user.id,
    "sem-dono": (e) => e.r.ownerId === null,
    parados: (e) => e.stale,
    "agendados-hoje": (e) => e.scheduledToday,
    "clientes-ativos": (e) => e.r.isClient,
  };
  const counts: QueueCounts = {
    total: entries.length,
    aguardando: count((e) => e.r.awaitingReplySince !== null),
    atrasados: count((e) => e.section === "atrasados"),
    perto: count((e) => e.section === "perto"),
    agendadosHoje: count((e) => e.scheduledToday),
    parados: count((e) => e.stale),
    acoesHoje: count((e) => e.section === "acoes-hoje"),
    tarefasAtrasadas: count((e) => e.overdueTask),
    views: {
      ...(Object.fromEntries((Object.keys(viewTest) as (keyof typeof viewTest)[]).map((v) => [v, count(viewTest[v])])) as Record<keyof typeof viewTest, number>),
      "sem-contato-90d": reengageCount?.n ?? 0,
    },
  };

  const filterTest: Record<QueueFilter, (e: Entry) => boolean> = {
    atrasados: (e) => e.section === "atrasados",
    esperando: (e) => e.r.awaitingReplySince !== null,
    parados: (e) => e.stale,
    "tarefas-atrasadas": (e) => e.overdueTask,
    "agendados-amanha": (e) => e.scheduledTomorrow,
    novos: (e) => e.isNew,
  };
  const focoTest: Record<QueueFoco, (e: Entry) => boolean> = { aguardando: (e) => e.r.awaitingReplySince !== null, atrasados: (e) => e.section === "atrasados" };
  const term = opts.q?.trim().toLowerCase() ?? "";
  const digits = (opts.q ?? "").replace(/\D/g, "");
  const wanted = reengage ? [] : entries.filter((e) =>
    viewTest[(opts.view ?? "todos") as keyof typeof viewTest](e) && (!opts.filtro || filterTest[opts.filtro](e)) && (!opts.foco || focoTest[opts.foco](e))
    && (!term || (e.r.name ?? "").toLowerCase().includes(term) || (digits.length >= 3 && e.r.phone.replace(/\D/g, "").includes(digits))));

  // Dentro da seção: quem espera há mais tempo primeiro; ações pelo vencimento; parados pelo mais antigo; o resto pela conversa mais recente.
  const order: Record<QueueSectionKey, (a: Entry, b: Entry) => number> = {
    atrasados: (a, b) => b.waitSec - a.waitSec, perto: (a, b) => b.waitSec - a.waitSec, aguardando: (a, b) => b.waitSec - a.waitSec,
    "acoes-hoje": (a, b) => time(a.r.taskDueAt) - time(b.r.taskDueAt),
    parados: (a, b) => time(a.r.stageEnteredAt) - time(b.r.stageEnteredAt),
    "aguardando-cliente": (a, b) => time(b.r.lastAt) - time(a.r.lastAt),
    reengajar: () => 0,
  };
  const picked: { r: Light; section: QueueSectionKey; signals: string[] }[] = reengage
    ? reengageRows.map((r) => ({ r, section: "reengajar" as const, signals: [...(r.isClient ? ["Cliente"] : []), ...(r.ownerId ? [] : ["Sem dono"])] })).sort((a, b) => time(b.r.lastAt ?? b.r.createdAt) - time(a.r.lastAt ?? a.r.createdAt))
    : SECTION_ORDER.flatMap((key) => wanted.filter((e) => e.section === key).sort(order[key]));
  const total = picked.length;
  const shown = picked.slice(0, limit);
  const det = await details(shown.map((p) => p.r.id));
  const sections: QueueSection[] = [];
  for (const p of shown) {
    const d = det.get(p.r.id);
    const r = p.r;
    const item: QueueItem = {
      dealId: r.id, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: d?.hasAvatar ?? false,
      awaitingSince: p.section === "reengajar" || !r.awaitingReplySince ? null : new Date(r.awaitingReplySince).toISOString(), slaMinutes: r.slaMinutes,
      lastMessage: d?.lastMessage ?? null, lastKind: d?.lastKind ?? null, lastDirection: r.lastDirection, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      stageKey: r.stageKey, stageName: r.stageName, sourceLabel: d?.sourceLabel ?? "", ownerName: r.ownerName,
      ...(r.taskDueAt && d?.taskTitle && p.section !== "reengajar" ? { nextAction: { title: d.taskTitle, dueAt: new Date(r.taskDueAt).toISOString() } } : {}),
      signals: p.signals,
    };
    const last = sections.at(-1);
    if (last && last.key === p.section) last.items.push(item); else sections.push({ key: p.section, items: [item] });
  }
  // A conferência só acompanha as visões em que faz sentido e some quando há busca/filtro (a lista ali é outra pergunta).
  const view = opts.view ?? "todos";
  const refined = !!(opts.q?.trim() || opts.filtro || opts.foco || opts.etapa || opts.dono || opts.fonte);
  const conferir = refined || !["todos", "meus", "agendados-hoje"].includes(view) ? [] : await attendanceDue(user, now, { mine: view === "meus" });
  return { sections, counts, truncated: total > shown.length ? { shown: shown.length, total } : null, conferir };
}

/** O lead que espera há mais tempo no escopo de quem pediu (sem o `exceptId`): destino do "Próximo da fila", sem montar a Fila inteira. */
export async function nextWaitingId(user: Who, exceptId: string): Promise<string | null> {
  const sc = scopeCond(user);
  const [row] = await db.select({ id: deals.id }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false), sql`${deals.awaitingReplySince} is not null`,
      isUuid(exceptId) ? sql`${deals.id} <> ${exceptId}` : undefined, ...(sc ? [sc] : [])))
    .orderBy(asc(deals.awaitingReplySince)).limit(1);
  return row?.id ?? null;
}

/**
 * Um lead só, no formato da Fila: serve ao cabeçalho do painel quando o lead foi aberto por link (hard load) ou não está na lista
 * (filtro, busca); não devolve lead arquivado nem contato ignorado. Sem seções: as etiquetas de sinal ficam de fora, porque só a lista usa.
 */
export async function getQueueItem(id: string): Promise<QueueItem | null> {
  if (!isUuid(id)) return null;
  // Arquivados e contatos ignorados ficam fora, como na Fila.
  const [r] = await lightRows([eq(deals.id, id), isNull(deals.archivedAt), eq(contacts.ignored, false)]);
  if (!r) return null;
  const d = (await details([id])).get(id);
  return {
    dealId: r.id, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: d?.hasAvatar ?? false,
    awaitingSince: r.awaitingReplySince ? new Date(r.awaitingReplySince).toISOString() : null, slaMinutes: r.slaMinutes,
    lastMessage: d?.lastMessage ?? null, lastKind: d?.lastKind ?? null, lastDirection: r.lastDirection, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
    stageKey: r.stageKey, stageName: r.stageName, sourceLabel: d?.sourceLabel ?? "", ownerName: r.ownerName, signals: [],
  };
}
