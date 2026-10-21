import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { tagsOf } from "../domain/tags";
import { can } from "@/lib/permissions";
import { db } from "../db";
import { channels, contacts, deals, lists, stages, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { canReceiveConversation } from "../domain/team-scope";
import { SOURCE_EXPR } from "../reports/common";
import { businessSecondsBetween, daysCountingOpenDays } from "../../lib/business-hours";
import { retomadaSuperada } from "../../lib/conversation-status";
import { SECTION_ORDER, slaLevel, type QueueAba, type QueueFoco, type QueueSectionKey, type QueueView } from "../../lib/queue";
import { transferText } from "../../lib/alert-copy";
import { callPreview, type CallInfo } from "../../lib/calls";
import type { QueueFilter } from "../../lib/report-links";
import { lateDealIds } from "./late-count";
import { phoneMatches, phoneSearchVariants } from "@/lib/phone-search";
import { cpfSearchDigits } from "@/lib/cpf";
import { isUuid } from "../../lib/uuid";
import { todayBahia } from "../../lib/agenda";
import { slotMs } from "../../lib/schedule";
import { teamNameCol, teamNameOf } from "./team-name";
import { PAUSED_BADGE, pauseOf } from "@/lib/consent";
import { RETURN_INVITE_BADGE, returnInviteActive } from "../domain/return-invite";
import type { ContactKind } from "../../lib/contact-kind";
import { signalsOf, SIGNAL_LABEL, SIGNAL_WINDOW, QUEUE_SIGNAL_MAX, compileMatchers, type Signal, type SignalMessage, type KeywordItem } from "../domain/signals";

export type QueueItem = {
  dealId: string; contactId: string; name: string; phone: string; hasAvatar: boolean;
  /** Tipo do contato (cliente, equipe, fornecedor, spam): o "Marcar como…" do botão direito mostra o atual. */
  contactKind?: ContactKind;
  /** Versão da foto (quando o worker a revisou): vai na URL da foto, que então pode ficar em cache longo. */
  avatarV?: string | null;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null; slaMinutes: number | null;
  /** Alerta de espera aberto (o mesmo do sino): só ele pinta de vermelho. */
  alert?: boolean;
  lastMessage: string | null; lastKind: string | null; lastDirection: "in" | "out" | null;
  /** Última mensagem em áudio: duração (s) e transcrição, para a prévia "Áudio (0:42): …". */
  lastDurationSec?: number | null; lastTranscript?: string | null;
  /** Última mensagem do lead (ISO); em "Para reengajar", a última do contato. */
  lastAt: string | null;
  stageKey: string; stageName: string; sourceLabel: string; ownerName: string | null;
  /** Tipo da etapa (lead, atendimento, agendado…): a linha só mostra a etapa quando ela não é a esperada para a seção. */
  stageKind?: string;
  /** Cor da etapa (Configurações): a linha mostra a etapa com essa cor. */
  stageColor?: string;
  /** Nome da equipe da dona ("Cati"), quem escreveu a última mensagem da Casa e quem respondeu por último quando não é a dona (Lote 1A). */
  ownerShort?: string | null; lastAuthorName?: string | null; /** Por onde saiu a última mensagem da Casa. */ lastSentVia?: "celular" | "crm" | null; repliedByName?: string | null;
  nextAction?: { title: string; dueAt: string };
  /** Estado da conversa: Novo, Agendado hoje ou amanhã. */
  badges?: string[];
  /** Sinais automáticos das mensagens (risco, palavra-chave, interesse), no máximo 2. */
  signals: string[];
  /** Etiquetas da cliente (criadas pela equipe na conversa), mostradas separadas dos sinais. */
  tags: string[];
  /** Mensagens da cliente que ninguém da Casa abriu (bolinha verde da linha); 0 ou ausente = lida. */
  unread?: number;
  /** Status da conversa (Resolvido = resolvida; Aberto = a cliente espera a Casa; senão Aguardando): ver `conversationStatus`. */
  resolved?: boolean;
  /** Cor de cada etiqueta (nome → #rrggbb), só das que têm cor. */
  tagColors?: Record<string, string>;
  /** Sem próxima ação e além do limite da etapa: há quantos dias está parada. */
  stoppedDays?: number;
  /** "Bruna te passou esta conversa" (para a nova dona) ou "Bruna passou para Ana" (para quem olha de fora), até a nova dona responder. */
  transferNote?: string;
};
/** `n`: o número da frase fixa da seção (minutos que faltam em "Quase no prazo"; dias parados em "Parados"), o menor da seção. */
export type QueueSection = { key: QueueSectionKey; items: QueueItem[]; n?: number };
export type QueueCounts = {
  /** Leads abertos no escopo de quem pediu (não muda com busca, view, filtro nem limite). */
  total: number; aguardando: number; atrasados: number; perto: number; agendadosHoje: number; parados: number; acoesHoje: number; tarefasAtrasadas: number;
  /** Leads com sinal de reclamação ou de evento/noiva nas mensagens (chips de foco). */
  reclamacoes: number; eventos: number;
  /** Conversas para retomar: a Casa já respondeu e há um combinado com data (aba "Para retomar"). */
  retomar: number;
  /** Conversas com mensagem não lida (aba "Não lidas"). */
  naoLidas: number;
  /** Aba Todas: as abertas e as resolvidas. */
  todasTotal?: number;
  /** Conversas da Equipe (números de funcionárias) com mensagem não lida: a aba Equipe acende. */
  equipeNaoLidas: number;
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
  /** `dono: "sem"` = conversas sem dona (combina com os outros filtros). */
  dono?: string | null; etapa?: string | null; fonte?: string | null;
  /** Id de uma etiqueta: só clientes com ela (Lote 4). */
  etiqueta?: string | null;
  /** Mais etiquetas (ids) e a regra delas: `todas` (tem todas), `qualquer` (tem alguma, o padrão) ou `nao_tem` (não tem nenhuma). Somam-se a `etiqueta`, que continua obrigatória. */
  etiquetas?: string[] | null; regraEtiqueta?: "todas" | "qualquer" | "nao_tem" | null;
  /** Última mensagem (de qualquer lado) há N dias ou mais (1 a 365). */
  diasSemConversa?: number | null;
  /** Id de um setor: só as conversas passadas para ele (Setores, item 15). Id que não é uuid é ignorado. */
  setor?: string | null;
  /** Aba "Não lidas": só as conversas com mensagem da cliente que ninguém abriu. */
  aba?: QueueAba | null;
  now?: Date;
  /** Máximo de leads devolvidos (os `counts` valem para todos). */
  limit?: number;
};

export const QUEUE_LIMIT = 1000;
const ETAPA_KEY = /^[a-z0-9_]{1,40}$/i;
/** `etapa=followup` (a estação "Aguardando cliente" da Jornada) é a etapa desse tipo, como a coluna do Quadro. */
export const FOLLOWUP_STATION = "followup";

/** O nome da etapa do `?etapa=`, para o aviso "Mostrando: etapa Lead" da Fila. Chave que não existe: null (o filtro não acha ninguém, o aviso não mente). */
export async function queueStageLabel(etapa: string | null | undefined): Promise<string | null> {
  if (!etapa || !ETAPA_KEY.test(etapa)) return null;
  if (etapa === FOLLOWUP_STATION) {
    const [s] = await db.select({ name: stages.name }).from(stages).where(and(eq(stages.kind, "followup"), eq(stages.active, true))).orderBy(asc(stages.position)).limit(1);
    return s?.name ?? "Aguardando cliente";
  }
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

type Who = Pick<SessionUser, "id" | "perms">;
/** Sem "ver conversas de todas": os leads dela e os sem dono; com ela, todos. */
const scopeCond = (user: Who, onlyOwn = false): SQL | null =>
  can(user.perms, "atendimento.todas") ? null : onlyOwn ? eq(deals.ownerId, user.id) : sql`(${deals.ownerId} = ${user.id} or ${deals.ownerId} is null)`;

/** Primeira fase: só o que a classificação e os números precisam (sem texto de mensagem), para todos os leads do escopo. */
type Light = {
  id: string; contactId: string; name: string | null; phone: string; isClient: boolean; contactKind: ContactKind; ownerId: string | null; ownerName: string | null;
  stageKey: string; stageName: string; stageKind: string; stageColor: string; slaMinutes: number | null; staleDays: number | null; stageEnteredAt: Date; awaitingReplySince: Date | null;
  scheduledAt: Date | null; createdAt: Date; imported: boolean; lastAt: Date | null; lastDirection: "in" | "out" | null; taskDueAt: Date | null;
  channelId: string | null;
  ownerShort: string | null; lastReplyById: string | null; lastReplyName: string | null;
  /** Aberta pelo convite de retorno (mensagem em massa) e esperando a resposta: selo na linha. */ returnInvite: boolean;
  /** Automáticas pausadas para esta cliente (selo na linha). */ pausedUntil: Date | null;
  /** Mensagens da cliente não lidas (até 99). */ unread: number;
  /** Conversa resolvida (o antigo Encerrar). */ resolved: boolean;
};
/**
 * Não lidas: mensagens da cliente depois da última abertura da conversa (`seen_at`), da última resposta da Casa, do Resolvido, do Encerrar e do "Não é cliente" (arquivar).
 * "Marcar como não lida" (Fase B) conta como pelo menos 1 até alguém abrir a conversa.
 * Até 99 (a bolinha não precisa de mais): o `limit` para a contagem cedo e usa o índice (deal_id, created_at).
 */
const UNREAD = sql<number>`greatest((select count(*)::int from (select 1 from messages mu where mu.deal_id = ${deals.id} and mu.direction = 'in' and mu.deleted_at is null
  and mu.created_at > greatest(coalesce(${deals.seenAt}, '-infinity'::timestamptz), coalesce(${deals.lastOutboundAt}, '-infinity'::timestamptz),
    coalesce(${deals.resolvedAt}, '-infinity'::timestamptz), coalesce(${deals.conversationArchivedAt}, '-infinity'::timestamptz), coalesce(${deals.archivedAt}, '-infinity'::timestamptz)) limit 99) u), (case when ${deals.markedUnreadAt} is not null then 1 else 0 end))`;
const LAST_OF_CONTACT = sql`(select max(m2.created_at) from messages m2 where m2.contact_id = ${contacts.id})`;

async function lightRows(conds: SQL[], opts: { lastOfContact?: boolean; limit?: number } = {}): Promise<Light[]> {
  const q = db.select({
    id: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, isClient: contacts.isClient, contactKind: contacts.kind, ownerId: deals.ownerId, ownerName: users.name,
    ownerShort: teamNameCol(), lastReplyById: deals.lastReplyById, lastReplyName: teamNameOf(deals.lastReplyById),
    stageKey: stages.key, stageName: stages.name, stageKind: stages.kind, stageColor: stages.color, slaMinutes: stages.slaMinutes, staleDays: stages.staleDays,
    stageEnteredAt: deals.stageEnteredAt, awaitingReplySince: deals.awaitingReplySince, scheduledAt: deals.scheduledAt, createdAt: deals.createdAt,
    imported: sql<boolean>`exists (select 1 from deal_events he where he.deal_id = ${deals.id} and he.type = 'lead_criado' and he.payload->>'historico' = 'true')`,
    lastAt: opts.lastOfContact ? sql<Date | null>`${LAST_OF_CONTACT}` : sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
    taskDueAt: sql<Date | null>`nt.due_at`, channelId: deals.channelId, returnInvite: returnInviteActive(deals.id), pausedUntil: contacts.automationsPausedUntil, unread: UNREAD,
    resolved: sql<boolean>`${deals.conversationArchivedAt} is not null`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.created_at, m.direction from messages m where m.deal_id = ${deals.id} and m.hidden_at is null order by m.created_at desc, m.id desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral (select t.due_at from tasks t where t.deal_id = ${deals.id} and t.done_at is null and t.kind in ('proxima_acao', 'retorno', 'comparecimento') order by t.due_at asc limit 1) nt`, sql`true`)
    .where(and(...conds))
    .orderBy(asc(deals.awaitingReplySince), asc(deals.createdAt));
  return (opts.limit ? await q.limit(opts.limit) : await q) as unknown as Light[];
}

/** Segunda fase: o texto (última mensagem, título da próxima ação, origem, foto) só dos leads que vão para a tela. */
async function details(ids: string[]) {
  if (!ids.length) return new Map<string, { hasAvatar: boolean; avatarV: string | null; sourceLabel: string; lastMessage: string | null; lastKind: string | null; lastDurationSec: number | null; lastTranscript: string | null; taskTitle: string | null; lastAuthorName: string | null; lastSentVia: "celular" | "crm" | null }>();
  const rows = await db.select({
    id: deals.id, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`,
    avatarV: sql<string | null>`case when ${contacts.avatarPath} is not null then coalesce(floor(extract(epoch from ${contacts.avatarCheckedAt}))::bigint::text, '0') end`, sourceLabel: sql<string>`${SOURCE_EXPR("deals")}`,
    lastMessage: sql<string | null>`lm.body`, lastKind: sql<string | null>`lm.kind`,
    lastDurationSec: sql<number | null>`lm.media_duration_sec`, lastTranscript: sql<string | null>`lm.transcript`, lastAuthorName: teamNameOf(sql`lm.sent_by_user_id`), lastSentVia: sql<"celular" | "crm" | null>`lm.sent_via`, taskTitle: sql<string | null>`nt.title`,
    lastCall: sql<CallInfo | null>`lm.call`, lastCallNote: sql<string | null>`lm.call_note`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    // Ligação (Lote 5): a prévia leva a anotação dela ("Ligação 3 min · marcou corte sábado").
    .leftJoin(sql`lateral (select m.body, m.kind, m.direction, m.sent_by_user_id, m.sent_via, m.call, m.media_duration_sec, m.transcript,
        case when m.kind = 'call' then (select coalesce(nullif(n.subject, ''), n.body) from contact_notes n where n.message_id = m.id order by n.created_at desc limit 1) end as call_note
      from messages m where m.deal_id = ${deals.id} order by m.created_at desc, m.id desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral (select t.title from tasks t where t.deal_id = ${deals.id} and t.done_at is null and t.kind in ('proxima_acao', 'retorno', 'comparecimento') order by t.due_at asc limit 1) nt`, sql`true`)
    .where(inArray(deals.id, ids));
  return new Map(rows.map(({ lastCall, lastCallNote, lastDirection, ...r }) => [r.id, r.lastKind === "call" ? { ...r, lastMessage: callPreview(lastCall, lastCallNote, r.lastMessage, lastDirection ?? "in") } : r]));
}

type SignalInfo = { labels: string[]; kinds: Set<Signal>; boost: boolean };
/** Serviços ativos e palavras-chave da gestão (Configurações › Listas): a comparação é por palavra/frase inteira. */
async function signalSources() {
  const rows = await db.select({ kind: lists.kind, label: lists.label, body: lists.body, meta: lists.meta }).from(lists)
    .where(and(eq(lists.active, true), inArray(lists.kind, ["service", "keyword"])));
  const services = rows.filter((r) => r.kind === "service").map((r) => ({ label: r.label }));
  const keywords: KeywordItem[] = rows.filter((r) => r.kind === "keyword").map((r) => ({
    label: r.label, phrases: (r.body ?? "").split("\n").map((l) => l.trim()).filter(Boolean), boost: !!(r.meta as { boost?: boolean } | null)?.boost,
  }));
  return { services, keywords };
}

/**
 * Sinais da conversa: UMA consulta com as últimas ~30 mensagens de cada lead (sem N+1). Etiquetas na ordem de prioridade
 * (sinais de risco, palavras-chave da gestão, interesse pelo serviço), no máximo QUEUE_SIGNAL_MAX; `boost` sobe dentro da seção.
 */
async function signalInfoFor(ids: string[], now: Date): Promise<Map<string, SignalInfo>> {
  const out = new Map<string, SignalInfo>();
  if (!ids.length) return out;
  // Só as últimas SIGNAL_WINDOW mensagens de cada lead (lateral + limit usa o índice; não lê a conversa inteira).
  const [rows, src] = await Promise.all([
    db.execute(sql`select x.deal_id, m.direction, m.body, m.created_at
      from unnest(array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]) as x(deal_id)
      cross join lateral (select m.direction, m.body, m.created_at from messages m where m.deal_id = x.deal_id order by m.created_at desc, m.id desc limit ${SIGNAL_WINDOW}) m`)
      .then((r) => r.rows as { deal_id: string; direction: "in" | "out"; body: string | null; created_at: Date }[]),
    signalSources(),
  ]);
  const match = compileMatchers(src.services, src.keywords);
  const by = new Map<string, SignalMessage[]>();
  for (const r of rows) { const l = by.get(r.deal_id) ?? []; l.push({ direction: r.direction, body: r.body, createdAt: r.created_at }); by.set(r.deal_id, l); }
  for (const [id, msgs] of by) {
    const kinds = signalsOf(msgs, now);
    const inbound = msgs.filter((m) => m.direction === "in" && m.body).map((m) => m.body!);
    const kws = match.keywords(inbound);
    const svc = match.service(inbound);
    const labels = [...kinds.map((k) => SIGNAL_LABEL[k]), ...kws.map((k) => k.label), ...(svc ? [`Interesse: ${svc.label}`] : [])].slice(0, QUEUE_SIGNAL_MAX);
    const boost = kws.some((k) => k.boost) || kinds.includes("reclamacao") || kinds.includes("urgente");
    if (labels.length || boost) out.set(id, { labels, kinds: new Set(kinds), boost });
  }
  return out;
}

/**
 * Transferência ainda não respondida: a última troca de dona foi feita por outra pessoa (Transferir, atribuir em massa) e a nova dona
 * ainda não respondeu desde então. Assumir para si, distribuição automática e devolução à fila não marcam. Devolve o nome de quem passou.
 */
async function transferredBy(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = (await db.execute(sql`select distinct on (e.deal_id) e.deal_id, e.type, e.user_id, e.created_at, u.name, d.owner_id, d.last_outbound_at
    from deal_events e join deals d on d.id = e.deal_id left join users u on u.id = e.user_id
    where e.deal_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) and e.type in ('assumiu', 'responsavel_alterado', 'distribuido', 'devolvido_a_fila')
    order by e.deal_id, e.created_at desc`)).rows as { deal_id: string; type: string; user_id: string | null; created_at: Date; name: string | null; owner_id: string | null; last_outbound_at: Date | null }[];
  for (const r of rows) {
    if (r.type !== "responsavel_alterado" || !r.user_id || !r.owner_id || r.user_id === r.owner_id || !r.name) continue;
    if (r.last_outbound_at && new Date(r.last_outbound_at).getTime() >= new Date(r.created_at).getTime()) continue;
    out.set(r.deal_id, r.name);
  }
  return out;
}

export const ATTENDANCE_DUE_LIMIT = 20;

/**
 * A conferência de comparecimento: leads em Agendado cujo horário já passou e que ainda não têm Compareceu/Faltou ("confirmado" pela enquete conta como
 * não conferido). Mesmo escopo da Fila (atendente vê os dela e os sem dono); o mais antigo primeiro.
 * Na Casa de um dia que já passou também entra: marcaram Chegou e ninguém finalizou (o caixa no Avec não muda o status do CRM), e sem isso
 * a conversa ficaria parada em Na Casa para sempre (lá não há tentativas nem aviso de parado). A de hoje, não: a cliente pode estar no salão.
 */
export async function attendanceDue(user: Who, now: Date, opts: { mine?: boolean; limit?: number } = {}): Promise<AttendanceDue[]> {
  const sc = scopeCond(user);
  const rows = await db.select({ dealId: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, scheduledAt: deals.scheduledAt, ownerName: users.name })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(users, eq(users.id, deals.ownerId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.kind, "cliente"), or(eq(stages.kind, "agendado"), and(eq(stages.kind, "na_casa"), sql`${deals.scheduledAt} < ${new Date(slotMs(todayBahia(now), "00:00")).toISOString()}::timestamptz`)), ...(opts.mine ? [eq(deals.ownerId, user.id)] : []),
      sql`${deals.scheduledAt} <= ${now.toISOString()}::timestamptz`, sql`(${deals.attendance} is null or ${deals.attendance} = 'confirmado')`,
      // Uma só verdade (psico r68 #8): se a Agenda já tem a visita dela finalizada, faltou ou em andamento, ninguém pergunta "Ela veio?".
      sql`not exists (select 1 from appointments ap where ap.contact_id = ${deals.contactId} and ap.avec_twin_of is null and ap.status in ('compareceu', 'faltou', 'chegou', 'em_atendimento')
        and ap.starts_at between ${deals.scheduledAt} - interval '12 hours' and ${deals.scheduledAt} + interval '12 hours')`, ...(sc ? [sc] : [])))
    .orderBy(asc(deals.scheduledAt)).limit(opts.limit ?? ATTENDANCE_DUE_LIMIT);
  return rows.map((r) => ({ dealId: r.dealId, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: r.hasAvatar, scheduledAt: new Date(r.scheduledAt!).toISOString(), ownerName: r.ownerName }));
}

/** Opções da barra de ações em massa: as etapas sem diálogo e, para a gestão, as pessoas da equipe. */
export type BulkOptions = { stages: { key: string; name: string; color?: string | null }[]; people: { id: string; name: string; availability: string; priorityLevel: number; waiting: number }[]; canAssign: boolean };
export async function getBulkOptions(user: Who): Promise<BulkOptions> {
  const [stageRows, people] = await Promise.all([
    db.select({ key: stages.key, name: stages.name, color: stages.color }).from(stages).where(and(eq(stages.active, true), inArray(stages.kind, ["lead", "atendimento", "followup", "proposta", "retorno"]))).orderBy(asc(stages.position)),
    can(user.perms, "atendimento.transferir") ? db.select({ id: users.id, name: users.name, availability: users.availability, priorityLevel: users.priorityLevel,
      waiting: sql<number>`(select count(*)::int from deals w where w.owner_id = "users"."id" and w.closed_at is null and w.archived_at is null and w.awaiting_reply_since is not null)` })
      .from(users).where(and(eq(users.active, true), canReceiveConversation())).orderBy(asc(users.name)) : Promise.resolve([]),
  ]);
  return { stages: stageRows, people, canAssign: can(user.perms, "atendimento.transferir") };
}

/**
 * Opções do painel "Filtros" da Fila: as etapas que podem estar na Fila (a Casa tem um funil só; fechado e perdido não ficam na Fila)
 * e, para quem vê as conversas de todas, as pessoas ativas da equipe (filtro por dona).
 */
export async function getQueueFilterOptions(user: Who): Promise<{ stages: { key: string; name: string; color: string | null; kind: string }[]; owners: { id: string; name: string }[] }> {
  const [stageRows, owners] = await Promise.all([
    db.select({ key: stages.key, name: stages.name, color: stages.color, kind: stages.kind }).from(stages)
      .where(and(eq(stages.active, true), sql`${stages.kind} not in ('fechado', 'perdido')`)).orderBy(asc(stages.position)),
    can(user.perms, "atendimento.todas")
      ? db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNotNull(users.passwordHash))).orderBy(asc(users.name))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  return { stages: stageRows, owners };
}

/**
 * "Sem contato há 90 dias": contatos para reengajar. Vale o ÚLTIMO lead do contato (aberto ou fechado, não arquivado), contato não ignorado,
 * cuja última mensagem do contato (ou a criação do lead, o que for mais recente) passou de 90 dias.
 */
const reengageConds = (user: Who, now: Date): SQL[] => [
  isNull(deals.archivedAt), eq(contacts.kind, "cliente"),
  sql`${deals.id} = (select d2.id from deals d2 where d2.contact_id = ${contacts.id} and d2.archived_at is null order by d2.created_at desc limit 1)`,
  sql`greatest(coalesce(${LAST_OF_CONTACT}, ${deals.createdAt}), ${deals.createdAt}) < ${new Date(now.getTime() - 90 * DAY_MS).toISOString()}::timestamptz`,
  ...(scopeCond(user) ? [scopeCond(user)!] : []),
];

/** Mensagem com o termo no texto ou na transcrição do áudio (busca da Fila). A partir de 3 letras, para não varrer as mensagens a cada tecla. */
const transcriptHit = (like: string, term: string) =>
  term.length >= 3 ? sql`exists (select 1 from messages tm where tm.deal_id = ${deals.id} and tm.deleted_at is null and (lower(tm.body) like ${like} or (tm.kind = 'audio' and lower(tm.transcript) like ${like})))` : sql`false`;

/** Telefone em qualquer formato (com ou sem +55, DDD, máscara, o 9): ver `phoneSearchVariants`. */
const phoneCond = (q: string): SQL => {
  const vs = phoneSearchVariants(q);
  return vs.length ? sql`(${sql.join(vs.map((v) => sql`${contacts.phoneE164} like ${"%" + v + "%"}`), sql` or `)})` : sql`false`;
};
const cpfCond = (q: string): SQL => { const d = cpfSearchDigits(q); return d ? sql`${contacts.cpf} like ${"%" + d + "%"}` : sql`false`; };
const qCond = (q: string): SQL => {
  const term = q.trim().toLowerCase(), like = `%${term}%`;
  return sql`(lower(coalesce(${contacts.name}, '')) like ${like} or ${phoneCond(q)} or ${cpfCond(q)} or ${transcriptHit(like, term)})`;
};

/**
 * A Fila: os leads abertos de quem pediu, em seções por urgência. Cada lead cai em UMA seção, na primeira que valer:
 * atrasados (alerta de espera aberto, ou já passou do prazo e o alerta nasce no próximo ciclo do motor) → quase no prazo (≥ 60% do prazo,
 * em horas de expediente; `slaLevel`). Canal em modo quieto não tem prazo (o motor não avisa): fica em "esperando a Casa responder".
 * → esperando a Casa responder → combinados para hoje e atrasados → parados (sem próxima ação e além do `stale_days`) → bola com a cliente.
 * Ninguém some: o que não é nada disso fica em "aguardando a cliente". Fora da Fila: arquivados, contatos ignorados e leads fechados/perdidos.
 * A view "Sem contato há 90 dias" é outra lista: contatos para reengajar (ver `reengageConds`).
 * Atendente vê os leads dela e os sem dono; gestão vê todos. Com `filtro` (links dos relatórios), atendente vê só os dela, como nos relatórios.
 * Os `counts` valem para todos os leads do escopo, mesmo quando `limit` corta a lista (`truncated`).
 */
/**
 * Conversa que espera a Casa vem antes de todas, em qualquer etapa: a última mensagem é da cliente OU a espera está aberta (`awaitingReplySince`).
 * A espera conta porque as mensagens automáticas (fora do horário, boas-vindas, ausência, menu, lembrete, enquete, agendada) entram como "out" e
 * não respondem a cliente. Dentro desse bloco, as atrasadas (prazo estourado) primeiro; depois a mensagem da cliente mais nova, como no WhatsApp.
 * As outras mantêm a ordem que já tinham. Vale a mensagem, não o "lida": abrir a conversa não a tira do lugar (a linha aberta não pula).
 */
export function unreadFirst<T extends { section: QueueSectionKey; r: { lastDirection: "in" | "out" | null; lastAt: Date | null; awaitingReplySince: Date | null } }>(list: T[], time: (d: Date | null) => number): T[] {
  const waitsForUs = (e: T) => e.r.lastDirection === "in" || !!e.r.awaitingReplySince;
  // Quando da cliente: a última mensagem, se for dela; senão (automática depois), o começo da espera.
  const clientAt = (e: T) => (e.r.lastDirection === "in" ? time(e.r.lastAt) : time(e.r.awaitingReplySince));
  // 16/10 (a Cati achou "fora de ordem" ver as atrasadas antigas antes das de hoje): ordem do WhatsApp, a mais nova primeiro.
  // A atrasada continua marcada em vermelho ("Atrasado") na própria linha.
  // 17/10 (vídeo da Cati): TODA a lista na ordem do WhatsApp, pela última mensagem da conversa, sem bloco à parte.
  // Quem espera a Casa continua marcado na linha (Aberto/Atrasado); empate: quem espera vem antes.
  const lastActivity = (e: T) => Math.max(time(e.r.lastAt), clientAt(e));
  return [...list].sort((a, b) => lastActivity(b) - lastActivity(a) || Number(waitsForUs(b)) - Number(waitsForUs(a)));
}

/** Quem respondeu por último, só quando não é a dona ("Dona: Sara · respondida por Cati"). */
const repliedBy = (r: Pick<Light, "ownerId" | "lastReplyById" | "lastReplyName">) => (r.lastReplyById && r.lastReplyById !== r.ownerId ? r.lastReplyName : null);

export async function getQueue(user: Who, opts: QueueOptions = {}): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? QUEUE_LIMIT;
  const gestor = can(user.perms, "atendimento.todas");
  const onlyOwn = !gestor && !!opts.filtro; // "só os seus" vale só para o link vindo de relatório
  const [hours, lateIds, quietRows] = await Promise.all([getBusinessHours(), lateDealIds(user, { onlyOwn }),
    db.select({ id: channels.id }).from(channels).where(gt(channels.quietUntil, now))]);
  const quietChannels = new Set(quietRows.map((c) => c.id));

  // Equipe (números de funcionárias) fica fora da Fila de clientes e das contagens: tem a aba própria.
  const conds: SQL[] = [isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.kind, "cliente")];
  const sc = scopeCond(user, onlyOwn);
  if (sc) conds.push(sc);
  // Filtro por etiqueta (Lote 4): só clientes com ela. Id que não é uuid (link velho) é ignorado.
  const hasTag = (id: string) => sql`exists (select 1 from contact_tags ct where ct.contact_id = ${deals.contactId} and ct.tag_id = ${id})`;
  const tagConds: SQL[] = isUuid(opts.etiqueta) ? [hasTag(opts.etiqueta)] : [];
  // Etiquetas com regra (Fase B): Todas, Qualquer ou Não tem. Id que não é uuid (link velho) é ignorado.
  const moreTags = [...new Set((opts.etiquetas ?? []).filter((t) => isUuid(t)))].slice(0, 10);
  if (moreTags.length) {
    const regra = opts.regraEtiqueta ?? "qualquer";
    if (regra === "todas") tagConds.push(...moreTags.map(hasTag));
    else if (regra === "nao_tem") tagConds.push(sql`not (${sql.join(moreTags.map(hasTag), sql` or `)})`);
    else tagConds.push(sql`(${sql.join(moreTags.map(hasTag), sql` or `)})`);
  }
  conds.push(...tagConds);
  if (isUuid(opts.setor)) conds.push(eq(deals.teamId, opts.setor));
  // Conversa arquivada (atendimento terminado) fica fora da Fila e tem visão própria; volta sozinha quando alguém escreve.
  const archivedConds = [...conds, isNotNull(deals.conversationArchivedAt)];
  conds.push(isNull(deals.conversationArchivedAt));
  // Dona: a gestão filtra por qualquer pessoa (painel Filtros ou link de relatório); a atendente já vê só as dela e as sem dona.
  if (gestor && opts.dono && isUuid(opts.dono)) conds.push(eq(deals.ownerId, opts.dono));
  if (opts.dono === "sem") conds.push(isNull(deals.ownerId));
  // Dias sem conversar: a última mensagem (de qualquer lado) é de N dias atrás ou mais; conversa sem mensagem nenhuma fica de fora.
  const dias = Math.trunc(Number(opts.diasSemConversa));
  if (dias >= 1 && dias <= 365) {
    const limite = new Date(now.getTime() - dias * 86_400_000);
    conds.push(sql`(select max(ml.created_at) from messages ml where ml.deal_id = ${deals.id} and ml.deleted_at is null) <= ${limite}`);
  }
  if (opts.etapa && ETAPA_KEY.test(opts.etapa)) conds.push(opts.etapa === FOLLOWUP_STATION ? eq(stages.kind, "followup") : eq(stages.key, opts.etapa));
  if (opts.fonte) conds.push(sql`${SOURCE_EXPR("deals")} = ${opts.fonte}`);

  const reengage = opts.view === "sem-contato-90d";
  const archivedView = opts.view === "arquivadas";
  // Equipe: as conversas abertas dos números de funcionária (encerradas também), fora do funil. "Não é cliente": a última conversa de cada contato
  // marcado, para mensagem nova não sumir sem rastro (fica guardada no lead arquivado e conta como não lida).
  const teamConds = [isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false), eq(contacts.isTeam, true), ...(sc ? [sc] : []), ...tagConds];
  const notClientConds = [eq(contacts.ignored, true), sql`${deals.id} = (select d2.id from deals d2 where d2.contact_id = ${contacts.id} order by d2.archived_at desc nulls first, d2.created_at desc limit 1)`,
    sql`exists (select 1 from messages nm where nm.deal_id = ${deals.id})`, ...(sc ? [sc] : []), ...tagConds];
  // Fornecedores (17/10): como a Equipe, uma lista própria fora da Fila de clientes e das contagens.
  const supplierConds = [isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.kind, "fornecedor"), ...(sc ? [sc] : []), ...tagConds];
  const listView = opts.view === "equipe" ? teamConds : opts.view === "fornecedores" ? supplierConds : opts.view === "nao-cliente" ? notClientConds : null;
  // Encerrada em que a cliente escreveu só "obrigada"/figurinha (continua encerrada, regra do remarketing): enquanto ninguém abre,
  // aparece também em Todas e Não lidas, como não lida. Antes ficava escondida em Encerradas e ninguém via a mensagem.
  const archivedUnreadConds = [...archivedConds, sql`${deals.lastInboundAt} > ${deals.conversationArchivedAt}`, sql`${UNREAD} > 0`];
  const countOf = (cs: SQL[]) => db.select({ n: sql<number>`count(*)::int`, unread: sql<number>`(count(*) filter (where ${UNREAD} > 0))::int` }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).where(and(...cs)).then((r) => r[0] ?? { n: 0, unread: 0 });
  // "Todas" é literalmente todas (20/10, pedido do dono): na aba Todas, sem foco nem "Não lidas", as Resolvidas entram na mesma lista, na ordem do
  // WhatsApp (as resolvidas que já têm mensagem nova continuam vindo pelas linhas abertas).
  const todasTab = (!opts.view || opts.view === "todos") && !opts.aba && !opts.foco && !opts.filtro;
  const resolvedExtra = todasTab ? lightRows([...archivedConds, sql`not (${deals.lastInboundAt} is not null and ${deals.lastInboundAt} > ${deals.conversationArchivedAt} and ${UNREAD} > 0)`,
    ...(opts.q?.trim() ? [qCond(opts.q)] : [])], { limit: limit }) : Promise.resolve([] as Light[]);
  // "Para retomar" também pega a resolvida que tem retomada aberta (20/10: a Sara marcou a retomada e clicou em Resolver; a conversa sumia).
  // Vencida e com conversa depois não conta (ver `retomadaSuperada`).
  const openResume = sql`exists (select 1 from tasks rt where rt.deal_id = ${deals.id} and rt.done_at is null and rt.kind in ('proxima_acao', 'retorno')
    and (rt.due_at >= ${now.toISOString()}::timestamptz or rt.due_at >= greatest(coalesce(${deals.lastInboundAt}, '-infinity'::timestamptz), coalesce(${deals.lastOutboundAt}, '-infinity'::timestamptz))))`;
  const resolvedResumeConds = [...archivedConds, openResume];
  const resolvedResume = opts.foco === "retomar" ? lightRows([...resolvedResumeConds, ...(opts.q?.trim() ? [qCond(opts.q)] : [])]) : Promise.resolve([] as Light[]);
  const resolvedResumeCount = countOf(resolvedResumeConds);
  const [rows, [reengageCount], reengageRows, [archivedCount], archivedRows, teamCount, notClientCount, listRows, supplierCount] = await Promise.all([
    Promise.all([lightRows(conds), reengage || archivedView || listView ? Promise.resolve([] as Light[]) : lightRows(archivedUnreadConds)]).then(([a, b]) => [...a, ...b]),
    db.select({ n: sql<number>`count(*)::int` }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(...reengageConds(user, now), ...tagConds)),
    reengage ? lightRows([...reengageConds(user, now), ...tagConds, ...(opts.q?.trim() ? [qCond(opts.q)] : [])], { lastOfContact: true }) : Promise.resolve([] as Light[]),
    db.select({ n: sql<number>`count(*)::int` }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).where(and(...archivedConds)),
    archivedView ? lightRows([...archivedConds, ...(opts.q?.trim() ? [qCond(opts.q)] : [])]) : Promise.resolve([] as Light[]),
    countOf(teamConds), countOf(notClientConds),
    listView ? lightRows([...listView, ...(opts.q?.trim() ? [qCond(opts.q)] : [])]) : Promise.resolve([] as Light[]),
    countOf(supplierConds),
  ]);

  const nowMs = now.getTime();
  const today0 = bahiaDayStart(now), today1 = today0 + DAY_MS, tomorrow1 = today1 + DAY_MS;
  const within = (d: Date | null, from: number, to: number) => !!d && new Date(d).getTime() >= from && new Date(d).getTime() < to;
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

  type Entry = { r: Light; section: QueueSectionKey; waitSec: number; alert: boolean; stale: boolean; stoppedDays: number | null; leftMin: number | null;
    scheduledToday: boolean; scheduledTomorrow: boolean; overdueTask: boolean; forRetomar: boolean; noContact90: boolean; isNew: boolean; badges: string[] };
  const entries: Entry[] = rows.map((r) => {
    const awaiting = r.awaitingReplySince;
    const waitSec = awaiting ? businessSecondsBetween(awaiting.getTime(), nowMs, hours) : 0;
    const alert = lateIds.has(r.id);
    // Modo quieto suspende os avisos do canal: sem prazo correndo, o lead não aparece como atrasado nem quase no prazo.
    const timed = !alert && !!awaiting && !!r.slaMinutes && !(r.channelId && quietChannels.has(r.channelId));
    const level = timed ? slaLevel({ awaiting: true, alert: false, waitSeconds: waitSec, slaMinutes: r.slaMinutes }) : null;
    const taskDue = r.taskDueAt ? new Date(r.taskDueAt) : null;
    const actionToday = !!taskDue && taskDue.getTime() < today1;
    // Dias com a Casa fechada não contam (a mesma conta do aviso "parado" do motor).
    const openDays = r.staleDays != null ? daysCountingOpenDays(r.stageEnteredAt.getTime(), nowMs, hours) : 0;
    const stale = r.staleDays != null && openDays >= r.staleDays;
    const section: QueueSectionKey = alert || level === "over" ? "atrasados" : level === "near" ? "perto" : awaiting ? "aguardando" : actionToday ? "acoes-hoje" : stale && !taskDue ? "parados" : "aguardando-cliente";
    const stoppedDays = stale && !taskDue ? Math.max(1, openDays) : null;
    const leftMin = level === "near" ? Math.max(1, Math.ceil((r.slaMinutes! * 60 - waitSec) / 60)) : null;
    const scheduledToday = within(r.scheduledAt, today0, today1);
    const scheduledTomorrow = within(r.scheduledAt, today1, tomorrow1);
    const overdueTask = !!taskDue && taskDue.getTime() < nowMs;
    const isNew = !r.imported && within(r.createdAt, today0, today1);
    // Só estado de verdade: "Cliente" (74% das linhas) mora no painel; "Sem dono" já está na linha; "Tarefa atrasada" e "Parado" viram texto.
    const badges = [...(r.returnInvite ? [RETURN_INVITE_BADGE] : []), ...(isNew ? ["Novo"] : []), ...(pauseOf(r.pausedUntil, now) ? [PAUSED_BADGE] : []), ...(scheduledToday ? ["Agendado hoje"] : scheduledTomorrow ? ["Agendado amanhã"] : [])];
    // Para retomar: a bola está com a cliente (a Casa já respondeu) e há um combinado em aberto com data.
    const forRetomar = !!taskDue && r.awaitingReplySince === null && !retomadaSuperada(taskDue, r.lastAt, nowMs);
    return { r, section, waitSec, alert, stale, stoppedDays, leftMin, scheduledToday, scheduledTomorrow, overdueTask, forRetomar, noContact90: false, isNew, badges };
  });

  // Sinais de todos os leads abertos antes de contar, filtrar e ordenar: o foco por sinal e a subida na seção dependem deles.
  // "Reengajar" não usa foco nem subida: calcula só para as linhas mostradas, mais abaixo.
  let info = reengage ? new Map<string, SignalInfo>() : await signalInfoFor(entries.map((e) => e.r.id), now);
  const count = (f: (e: Entry) => boolean) => entries.filter(f).length;
  const viewTest: Record<Exclude<QueueView, "sem-contato-90d" | "arquivadas" | "equipe" | "fornecedores" | "nao-cliente">, (e: Entry) => boolean> = {
    todos: () => true,
    meus: (e) => e.r.ownerId === user.id,
    "sem-dono": (e) => e.r.ownerId === null,
    parados: (e) => e.stale,
    "agendados-hoje": (e) => e.scheduledToday,
    "clientes-ativos": (e) => e.r.isClient,
  };
  // Os números das abas seguem a visão ligada (20/10: com "Minhas" ligado a aba dizia "Esperando 3" e a lista vinha vazia, porque as 3 eram de outra pessoa).
  const vt = viewTest[(opts.view ?? "todos") as keyof typeof viewTest] ?? viewTest.todos;
  const inView = (f: (e: Entry) => boolean) => count((e) => vt(e) && f(e));
  const counts: QueueCounts = {
    total: entries.length,
    aguardando: inView((e) => e.r.awaitingReplySince !== null),
    atrasados: count((e) => e.section === "atrasados"),
    perto: count((e) => e.section === "perto"),
    agendadosHoje: count((e) => e.scheduledToday),
    parados: count((e) => e.stale),
    acoesHoje: count((e) => e.section === "acoes-hoje"),
    tarefasAtrasadas: count((e) => e.overdueTask),
    reclamacoes: count((e) => !!info.get(e.r.id)?.kinds.has("reclamacao")),
    eventos: count((e) => !!info.get(e.r.id)?.kinds.has("evento")),
    retomar: inView((e) => e.forRetomar) + (!opts.view || opts.view === "todos" ? (await resolvedResumeCount).n : 0),
    naoLidas: inView((e) => e.r.unread > 0),
    /** Aba Todas: abertas + resolvidas (literalmente todas). Com uma visão ligada ("Minhas"…), só as dela. */
    todasTotal: opts.view && opts.view !== "todos" ? inView(() => true) : count((e) => !e.r.resolved) + (archivedCount?.n ?? 0),
    equipeNaoLidas: teamCount.unread,
    views: {
      ...(Object.fromEntries((Object.keys(viewTest) as (keyof typeof viewTest)[]).map((v) => [v, count(viewTest[v])])) as Record<keyof typeof viewTest, number>),
      "sem-contato-90d": reengageCount?.n ?? 0,
      arquivadas: archivedCount?.n ?? 0,
      equipe: teamCount.n,
      fornecedores: supplierCount.n,
      // No painel Filtros o "Não é cliente" mostra só as que têm mensagem nova (a lista mostra todas).
      "nao-cliente": notClientCount.unread,
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
  const focoTest: Record<QueueFoco, (e: Entry) => boolean> = {
    aguardando: (e) => e.r.awaitingReplySince !== null, atrasados: (e) => e.section === "atrasados", combinados: (e) => e.overdueTask,
    reclamacao: (e) => !!info.get(e.r.id)?.kinds.has("reclamacao"), evento: (e) => !!info.get(e.r.id)?.kinds.has("evento"),
    retomar: (e) => e.forRetomar,
  };
  const term = opts.q?.trim().toLowerCase() ?? "";
  const phoneVariants = phoneSearchVariants(opts.q);
  // CPF (o dono pediu: achar a conversa pelo CPF da cliente). Só dos leads em jogo, uma consulta.
  const cpfQ = cpfSearchDigits(opts.q);
  const byCpf = cpfQ && entries.length
    ? new Set((await db.select({ id: deals.id }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(inArray(deals.id, entries.map((e) => e.r.id)), sql`${contacts.cpf} like ${"%" + cpfQ + "%"}`))).map((x) => x.id))
    : new Set<string>();
  // Busca também nas transcrições dos áudios (só dos leads em jogo, uma consulta).
  const heard = term.length >= 3 && !reengage && !archivedView && entries.length
    ? new Set((await db.select({ id: deals.id }).from(deals).where(and(inArray(deals.id, entries.map((e) => e.r.id)), transcriptHit(`%${term}%`, term)))).map((x) => x.id))
    : new Set<string>();
  const wanted = reengage || archivedView || listView ? [] : entries.filter((e) =>
    viewTest[(opts.view ?? "todos") as keyof typeof viewTest](e) && (!opts.filtro || filterTest[opts.filtro](e)) && (!opts.foco || focoTest[opts.foco](e)) && (opts.aba !== "nao-lidas" || e.r.unread > 0)
    && (!term || (e.r.name ?? "").toLowerCase().includes(term) || phoneMatches(e.r.phone, phoneVariants) || heard.has(e.r.id) || byCpf.has(e.r.id)));

  // Dentro da seção: quem espera há mais tempo primeiro; ações pelo vencimento; parados pelo mais antigo; o resto pela conversa mais recente.
  const order: Record<QueueSectionKey, (a: Entry, b: Entry) => number> = {
    atrasados: (a, b) => b.waitSec - a.waitSec, perto: (a, b) => b.waitSec - a.waitSec, aguardando: (a, b) => b.waitSec - a.waitSec,
    "acoes-hoje": (a, b) => time(a.r.taskDueAt) - time(b.r.taskDueAt),
    parados: (a, b) => time(a.r.stageEnteredAt) - time(b.r.stageEnteredAt),
    "aguardando-cliente": (a, b) => time(b.r.lastAt) - time(a.r.lastAt),
    reengajar: () => 0,
    arquivadas: () => 0,
  };
  const picked: { r: Light; section: QueueSectionKey; badges: string[] }[] = listView
    ? unreadFirst(listRows.map((r) => ({ r, section: "aguardando-cliente" as const, badges: [] as string[] })).sort((a, b) => time(b.r.lastAt) - time(a.r.lastAt)), time)
    : archivedView
    ? archivedRows.map((r) => ({ r, section: "arquivadas" as const, badges: [] as string[] })).sort((a, b) => time(b.r.lastAt) - time(a.r.lastAt))
    : reengage
    ? reengageRows.map((r) => ({ r, section: "reengajar" as const, badges: [] as string[] })).sort((a, b) => time(b.r.lastAt ?? b.r.createdAt) - time(a.r.lastAt ?? a.r.createdAt))
    // Reclamação, urgente e palavra-chave com "subir na Fila" vêm primeiro DENTRO da seção (nunca passam de seção).
    // Mensagem de cliente não lida sobe para o topo, em qualquer etapa (a mais nova primeiro, como no WhatsApp); o resto segue a urgência.
    // Aba "Esperando" (20/10; pesquisa de inboxes: Help Scout, Front, Intercom): quem espera a Casa, a espera mais antiga primeiro, para ninguém
    // ficar esquecido. "Todas" continua na ordem do WhatsApp (pedido da Cati, 17/10).
    : opts.foco === "retomar"
    ? [...wanted, ...(await resolvedResume).map((r) => ({ r, section: "arquivadas" as const, badges: [] as string[] }))].sort((a, b) => time(a.r.taskDueAt) - time(b.r.taskDueAt))
    : opts.foco === "aguardando"
    ? [...wanted].sort((a, b) => time(a.r.awaitingReplySince) - time(b.r.awaitingReplySince))
    : todasTab
    ? unreadFirst([...SECTION_ORDER.flatMap((key) => wanted.filter((e) => e.section === key)), ...(await resolvedExtra).map((r) => ({ r, section: "arquivadas" as const, badges: [] as string[] }))], time)
    : unreadFirst(SECTION_ORDER.flatMap((key) => wanted.filter((e) => e.section === key).sort((a, b) => Number(!!info.get(b.r.id)?.boost) - Number(!!info.get(a.r.id)?.boost) || order[key](a, b))), time);
  const total = picked.length;
  const shown = picked.slice(0, limit);
  const ids = shown.map((p) => p.r.id);
  const [det, transfers, tagMap] = await Promise.all([details(ids), transferredBy(ids), tagsOf(shown.map((p) => p.r.contactId))]);
  if (reengage) info = await signalInfoFor(ids, now);
  const byId = new Map(entries.map((e) => [e.r.id, e]));
  const sections: QueueSection[] = [];
  for (const p of shown) {
    const d = det.get(p.r.id);
    const r = p.r;
    const e = byId.get(r.id);
    const by = transfers.get(r.id);
    const item: QueueItem = {
      dealId: r.id, contactId: r.contactId, contactKind: r.contactKind, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: d?.hasAvatar ?? false, avatarV: d?.avatarV ?? null,
      // Equipe e "Não é cliente" não têm prazo: a linha não conta espera nem atraso.
      awaitingSince: p.section === "reengajar" || listView || !r.awaitingReplySince ? null : new Date(r.awaitingReplySince).toISOString(), slaMinutes: listView ? null : r.slaMinutes,
      lastMessage: d?.lastMessage ?? null, lastKind: d?.lastKind ?? null, lastDurationSec: d?.lastDurationSec ?? null, lastTranscript: d?.lastTranscript ?? null, lastDirection: r.lastDirection, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      // Equipe e "Não é cliente" estão fora do funil: a etiqueta da linha diz isso, não a etapa.
      stageKey: r.stageKey, stageName: opts.view === "equipe" ? "Equipe" : opts.view === "fornecedores" ? "Fornecedor" : opts.view === "nao-cliente" ? "Spam" : r.stageName, stageKind: r.stageKind,
      stageColor: listView ? "#5c5c5c" : r.stageColor, sourceLabel: d?.sourceLabel ?? "",
      ownerName: r.ownerName, ownerShort: r.ownerShort, lastAuthorName: d?.lastAuthorName ?? null, lastSentVia: d?.lastSentVia ?? null, repliedByName: repliedBy(r),
      ...(r.taskDueAt && d?.taskTitle && p.section !== "reengajar" ? { nextAction: { title: d.taskTitle, dueAt: new Date(r.taskDueAt).toISOString() } } : {}),
      badges: p.badges,
      signals: info.get(r.id)?.labels ?? [],
      tags: (tagMap.get(r.contactId) ?? []).map((t) => t.name),
      ...(r.unread > 0 ? { unread: r.unread } : {}),
      ...(r.resolved ? { resolved: true } : {}),
      ...(() => { const c = Object.fromEntries((tagMap.get(r.contactId) ?? []).filter((t) => t.color).map((t) => [t.name, t.color as string])); return Object.keys(c).length ? { tagColors: c } : {}; })(),
      ...(e?.alert ? { alert: true } : {}),
      ...(e?.stoppedDays ? { stoppedDays: e.stoppedDays } : {}),
      ...(by ? { transferNote: transferText(by, r.ownerName, r.ownerId === user.id) } : {}),
    };
    const last = sections.at(-1);
    if (last && last.key === p.section) last.items.push(item); else sections.push({ key: p.section, items: [item] });
  }
  // O número da frase fixa: em "Quase no prazo", quantos minutos faltam para o primeiro estourar; em "Parados", há quantos dias (o menor).
  for (const s of sections) {
    const vals = s.items.map((i) => (s.key === "perto" ? byId.get(i.dealId)?.leftMin : s.key === "parados" ? byId.get(i.dealId)?.stoppedDays : null)).filter((v): v is number => v != null);
    if (vals.length) s.n = Math.min(...vals);
  }
  // A conferência só acompanha as visões em que faz sentido e some quando há busca/filtro (a lista ali é outra pergunta).
  const view = opts.view ?? "todos";
  const refined = !!(opts.q?.trim() || opts.filtro || opts.foco || opts.etapa || opts.dono || opts.fonte || opts.etiqueta || opts.etiquetas?.length || opts.diasSemConversa || opts.setor || opts.aba);
  const conferir = refined || !["todos", "meus", "agendados-hoje"].includes(view) ? [] : await attendanceDue(user, now, { mine: view === "meus" });
  return { sections, counts, truncated: total > shown.length ? { shown: shown.length, total } : null, conferir };
}

/**
 * O lead que espera há mais tempo no escopo de quem pediu (sem o `exceptId`): destino do "Próximo da fila", sem montar a Fila inteira.
 * Conversa encerrada fica de fora: ela não está na Fila.
 */
export async function nextWaitingId(user: Who, exceptId: string): Promise<string | null> {
  const sc = scopeCond(user);
  const [row] = await db.select({ id: deals.id }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), isNull(deals.conversationArchivedAt), eq(contacts.kind, "cliente"), sql`${deals.awaitingReplySince} is not null`,
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
    dealId: r.id, contactId: r.contactId, contactKind: r.contactKind, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: d?.hasAvatar ?? false, avatarV: d?.avatarV ?? null,
    awaitingSince: r.awaitingReplySince ? new Date(r.awaitingReplySince).toISOString() : null, slaMinutes: r.slaMinutes,
    lastMessage: d?.lastMessage ?? null, lastKind: d?.lastKind ?? null, lastDurationSec: d?.lastDurationSec ?? null, lastTranscript: d?.lastTranscript ?? null, lastDirection: r.lastDirection, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
    stageKey: r.stageKey, stageName: r.stageName, stageKind: r.stageKind, stageColor: r.stageColor, sourceLabel: d?.sourceLabel ?? "", ownerName: r.ownerName, ownerShort: r.ownerShort, lastAuthorName: d?.lastAuthorName ?? null, lastSentVia: d?.lastSentVia ?? null, repliedByName: repliedBy(r), badges: [], signals: [], tags: [],
    ...(r.unread > 0 ? { unread: r.unread } : {}),
    ...(r.resolved ? { resolved: true } : {}),
  };
}
