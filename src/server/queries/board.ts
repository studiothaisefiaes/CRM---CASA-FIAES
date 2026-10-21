import { phoneSearchVariants } from "@/lib/phone-search";
import { cpfSearchDigits } from "@/lib/cpf";
import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { activePurchaseSql } from "./package-purchase-sql";
import { can, canSeeDealMoney } from "@/lib/permissions";
import { SOURCE_EXPR } from "../reports/common";
import type { FunilFilter } from "../../lib/report-links";
import { isUuid } from "../../lib/uuid";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { businessSecondsBetween } from "../../lib/business-hours";
import { retomadaSuperada } from "../../lib/conversation-status";
import { stageVisibleTo } from "../../lib/stage-visibility";
import { BOARD_CLOSED_DAYS, boardUrgency, orderByUrgency, type BoardUrgency } from "../../lib/board-order";
import { lateDealIds, lateExists } from "./late-count";
import { teamNameCol, teamNameOf } from "./team-name";

export type BoardCard = {
  id: string; contactId: string; hasAvatar: boolean; contactName: string | null; phone: string; origin: string; ownerId: string | null; ownerName: string | null;
  /** Nome da equipe da dona, quem escreveu a última mensagem da Casa e quem respondeu por último quando não é a dona. */
  ownerShort?: string | null; lastAuthorName?: string | null; repliedByName?: string | null;
  stageId: string; awaitingReplySince: string | null; stageEnteredAt: string; lastMessage: string | null; lastMessageKind: string | null;
  /** Última mensagem em áudio: duração (s) e transcrição, para a prévia "Áudio (0:42): …". */
  lastMessageDurationSec?: number | null; lastMessageTranscript?: string | null;
  lastMessageAt: string | null; lastDirection: "in" | "out" | null; isClient: boolean; scheduledAt: string | null; valueCents: number | null;
  /** Urgência no Quadro (atrasado = alerta de espera aberto, como na Fila) e há quantos segundos de expediente a cliente espera. */
  urgency: BoardUrgency; waitSeconds: number;
  /** Aguardando cliente / Orçamento: em que tentativa está (0 = nenhuma). */ followupAttempt: number;
  /** Pacote ativo da cliente (selo "Pacote 3/10"; o pacote não é etapa). */ pkg: { used: number; total: number } | null;
  /** Nome da etapa de origem quando o card aparece no topo de "Em conversa" vindo de outra etapa (ela escreveu). */ stageName?: string;
  /** Ela escreveu e a Casa ainda não respondeu: topo de "Em conversa", em destaque. */ esperando?: boolean;
  /** Combinado de voltar a falar (retomada aberta): a data. Sem espera da Casa, o card fica na coluna "Para retomar". */ retomarAt?: string | null;
};
export type BoardStage = { id: string; key: string; name: string; kind: string; slaMinutes: number | null; color: string; cards: BoardCard[] };

/** Filtros vindos dos relatórios (drill-down): lista só os leads daquele número. */
export type BoardFilter = { ownerId?: string | null; origin?: string | null; q?: string | null; filtro?: FunilFilter | null; etapa?: string | null;
  /** Origem real (a mesma dos relatórios, com "Não identificada"). */ source?: string | null };

type Who = Pick<SessionUser, "id" | "perms"> & { profileId?: string | null };

/**
 * As condições do Quadro, num lugar só: o `getBoard` e a contagem da Jornada (`journey.ts`) usam as mesmas, então os números não divergem.
 * Leads abertos e os fechados/perdidos dos últimos `BOARD_CLOSED_DAYS` dias; sem arquivados, sem contato ignorado e sem conversa encerrada de lead aberto; escopo de quem pediu
 * (atendente vê os dela e os sem dono, e só os dela com `filtro` de relatório; gestão e `viewer` ausente veem todos); mais os filtros de drill-down.
 * `onlyOwn` diz se valeu o "só os dela" (o atraso se conta no mesmo escopo).
 */
export function boardConds(filter: BoardFilter = {}, viewer?: Who): { conds: SQL[]; onlyOwn: boolean } {
  const since = new Date(Date.now() - BOARD_CLOSED_DAYS * 86_400_000);
  // Equipe (número de funcionária) fica fora do funil: nem Quadro nem Jornada.
  const conds: SQL[] = [or(isNull(deals.closedAt), gte(deals.closedAt, since))!, isNull(deals.archivedAt), eq(contacts.kind, "cliente"),
    // Conversa encerrada (Encerrar conversa) sai do Quadro e da Jornada enquanto o lead está aberto; fechados e perdidos seguem na coluna deles.
    // 20/10: a resolvida com retomada aberta continua no Quadro (coluna "Para retomar").
    or(isNotNull(deals.closedAt), isNull(deals.conversationArchivedAt), sql`exists (select 1 from tasks rt where rt.deal_id = ${deals.id} and rt.done_at is null and rt.kind in ('proxima_acao', 'retorno'))`)!];
  const attendant = !!viewer && !can(viewer.perms, "atendimento.todas");
  const onlyOwn = attendant && !!filter.filtro;
  if (attendant) conds.push(onlyOwn ? eq(deals.ownerId, viewer.id) : or(eq(deals.ownerId, viewer.id), isNull(deals.ownerId))!);
  if (isUuid(filter.ownerId)) conds.push(eq(deals.ownerId, filter.ownerId));
  // A origem do Quadro é a mesma da Fila e dos relatórios (origem real; sem ela, "Não identificada"), nunca o canal.
  if (filter.origin) conds.push(sql`${SOURCE_EXPR("deals")} = ${filter.origin}`);
  if (filter.q) {
    const like = `%${filter.q.trim().toLowerCase()}%`;
    const vs = phoneSearchVariants(filter.q);
    const cpfQ = cpfSearchDigits(filter.q);
    // Mãe e filha no mesmo número (0051, 21/10): o nome de outra pessoa do número acha o cartão do número.
    conds.push(or(sql`lower(coalesce(${contacts.name}, '')) like ${like}`, sql`exists (select 1 from contacts pp where pp.shares_phone_with = ${contacts.id} and lower(coalesce(pp.name, '')) like ${like})`, ...vs.map((v) => sql`${contacts.phoneE164} like ${"%" + v + "%"}`), ...(cpfQ ? [sql`${contacts.cpf} like ${"%" + cpfQ + "%"}`] : []))!);
  }
  if (filter.filtro === "atrasados") {
    // Mesma regra do contador de atrasados: alerta de espera aberto (que não é de tarefa), sem contato ignorado.
    conds.push(lateExists(deals.id), eq(contacts.ignored, false));
  } else if (filter.filtro === "esperando") {
    conds.push(isNotNull(deals.awaitingReplySince), isNull(deals.closedAt), eq(contacts.ignored, false));
  } else if (filter.filtro === "parados") {
    conds.push(isNull(deals.closedAt), eq(contacts.ignored, false),
      sql`exists (select 1 from stages ps where ps.id = ${deals.stageId} and ps.stale_days is not null and ${deals.stageEnteredAt} <= now() - make_interval(days => ps.stale_days))`);
  }
  if (filter.source) conds.push(sql`${SOURCE_EXPR("deals")} = ${filter.source}`);
  if (filter.etapa && /^[a-z0-9_]{1,40}$/i.test(filter.etapa)) conds.push(sql`exists (select 1 from stages es where es.id = ${deals.stageId} and es.key = ${filter.etapa})`);
  return { conds, onlyOwn };
}

/**
 * O Quadro: os leads abertos e os fechados/perdidos dos últimos 30 dias, por etapa, cada coluna em ordem de urgência (ver `orderByUrgency`).
 * Condições e escopo em `boardConds`. Mostra no máximo 600 leads; a Jornada conta todos por conta própria.
 */
export async function getBoard(filter: BoardFilter = {}, viewer?: Who, now = new Date()): Promise<BoardStage[]> {
  const st = (await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position))).filter((s) => stageVisibleTo(s, viewer));
  const { conds, onlyOwn } = boardConds(filter, viewer);
  const money = !viewer || canSeeDealMoney(viewer.perms); // sem quem vê (Jornada, testes): com valor
  const [hours, lateIds] = await Promise.all([getBusinessHours(), lateDealIds(viewer ?? { id: "", perms: ["atendimento.todas"] }, { onlyOwn })]);
  const rows = await db.select({
    id: deals.id, contactId: contacts.id, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, contactName: contacts.name, phone: contacts.phoneE164, origin: sql<string>`${SOURCE_EXPR("deals")}`, ownerId: deals.ownerId, ownerName: users.name,
    ownerShort: teamNameCol(), lastReplyById: deals.lastReplyById, lastReplyName: teamNameOf(deals.lastReplyById), lastAuthorName: teamNameOf(sql`lm.sent_by_user_id`),
    stageId: deals.stageId, awaitingReplySince: deals.awaitingReplySince, stageEnteredAt: deals.stageEnteredAt, isClient: contacts.isClient,
    scheduledAt: deals.scheduledAt, valueCents: deals.valueCents,
    retomarAt: sql<Date | null>`(select min(rt.due_at) from tasks rt where rt.deal_id = ${deals.id} and rt.done_at is null and rt.kind in ('proxima_acao', 'retorno'))`,
    followupAttempt: deals.followupAttempt, pkgUsed: sql<number | null>`pk.used_sessions`, pkgTotal: sql<number | null>`pk.total_sessions`,
    lastMessage: sql<string | null>`lm.body`, lastMessageKind: sql<string | null>`lm.kind`,
    lastMessageDurationSec: sql<number | null>`lm.media_duration_sec`, lastMessageTranscript: sql<string | null>`lm.transcript`, lastMessageAt: sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.body, m.kind, m.created_at, m.direction, m.sent_by_user_id, m.media_duration_sec, m.transcript from ${messages} m where m.deal_id = ${deals.id} order by m.created_at desc, m.id desc limit 1) lm`, sql`true`)
    .leftJoin(sql`lateral ${activePurchaseSql(sql`${deals.contactId}`, sql`(now() at time zone 'America/Bahia')::date`)} pk`, sql`true`)
    .where(and(...conds))
    .orderBy(sql`${deals.awaitingReplySince} asc nulls last`, desc(deals.stageEnteredAt))
    .limit(600);
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return st.map((s) => {
    const open = s.kind !== "fechado" && s.kind !== "perdido";
    return {
      id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, color: s.color,
      cards: orderByUrgency(rows.filter((r) => r.stageId === s.id).map((r): BoardCard => {
        const { lastReplyById, lastReplyName, pkgUsed, pkgTotal, ...rest } = r;
        const waitSeconds = open && r.awaitingReplySince ? businessSecondsBetween(new Date(r.awaitingReplySince).getTime(), now.getTime(), hours) : 0;
        return {
          ...rest, awaitingReplySince: iso(r.awaitingReplySince), stageEnteredAt: r.stageEnteredAt.toISOString(),
          lastMessageAt: iso(r.lastMessageAt), scheduledAt: iso(r.scheduledAt), retomarAt: retomadaSuperada(r.retomarAt, r.lastMessageAt) ? null : iso(r.retomarAt), waitSeconds,
          valueCents: money ? r.valueCents : null,
          repliedByName: lastReplyById && lastReplyById !== r.ownerId ? lastReplyName : null,
          pkg: pkgUsed != null && pkgTotal != null ? { used: pkgUsed, total: pkgTotal } : null,
          urgency: open ? boardUrgency({ late: lateIds.has(r.id), awaiting: !!r.awaitingReplySince, waitSeconds, slaMinutes: s.slaMinutes }) : "idle",
        };
      })),
    };
  });
}

export async function getOrigins() {
  const rows = await db.selectDistinct({ origin: sql<string>`${SOURCE_EXPR("deals")}` }).from(deals);
  return rows.map((r) => r.origin).sort();
}

