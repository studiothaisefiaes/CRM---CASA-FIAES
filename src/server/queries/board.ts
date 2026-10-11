import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { SOURCE_EXPR } from "../reports/common";
import type { FunilFilter } from "../../lib/report-links";
import { isUuid } from "../../lib/uuid";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { businessSecondsBetween } from "../../lib/business-hours";
import { BOARD_CLOSED_DAYS, boardUrgency, orderByUrgency, type BoardUrgency } from "../../lib/board-order";
import { lateDealIds, lateExists } from "./late-count";

export type BoardCard = {
  id: string; contactId: string; hasAvatar: boolean; contactName: string | null; phone: string; origin: string; ownerId: string | null; ownerName: string | null;
  stageId: string; awaitingReplySince: string | null; stageEnteredAt: string; lastMessage: string | null; lastMessageKind: string | null;
  lastMessageAt: string | null; lastDirection: "in" | "out" | null; isClient: boolean; scheduledAt: string | null; valueCents: number | null;
  /** Urgência no Quadro (atrasado = alerta de espera aberto, como na Fila) e há quantos segundos de expediente a cliente espera. */
  urgency: BoardUrgency; waitSeconds: number;
};
export type BoardStage = { id: string; key: string; name: string; kind: string; slaMinutes: number | null; color: string; cards: BoardCard[] };

/** Filtros vindos dos relatórios (drill-down): lista só os leads daquele número. */
export type BoardFilter = { ownerId?: string | null; origin?: string | null; q?: string | null; filtro?: FunilFilter | null; etapa?: string | null;
  /** Origem real (a mesma dos relatórios, com "Não identificada"). */ source?: string | null };

type Who = Pick<SessionUser, "id" | "role">;

/**
 * As condições do Quadro, num lugar só: o `getBoard` e a contagem da Jornada (`journey.ts`) usam as mesmas, então os números não divergem.
 * Leads abertos e os fechados/perdidos dos últimos `BOARD_CLOSED_DAYS` dias; sem arquivados e sem contato ignorado; escopo de quem pediu
 * (atendente vê os dela e os sem dono, e só os dela com `filtro` de relatório; gestão e `viewer` ausente veem todos); mais os filtros de drill-down.
 * `onlyOwn` diz se valeu o "só os dela" (o atraso se conta no mesmo escopo).
 */
export function boardConds(filter: BoardFilter = {}, viewer?: Who): { conds: SQL[]; onlyOwn: boolean } {
  const since = new Date(Date.now() - BOARD_CLOSED_DAYS * 86_400_000);
  const conds: SQL[] = [or(isNull(deals.closedAt), gte(deals.closedAt, since))!, isNull(deals.archivedAt), eq(contacts.ignored, false)];
  const attendant = !!viewer && viewer.role !== "gestor";
  const onlyOwn = attendant && !!filter.filtro;
  if (attendant) conds.push(onlyOwn ? eq(deals.ownerId, viewer.id) : or(eq(deals.ownerId, viewer.id), isNull(deals.ownerId))!);
  if (isUuid(filter.ownerId)) conds.push(eq(deals.ownerId, filter.ownerId));
  // A origem do Quadro é a mesma da Fila e dos relatórios (origem real; sem ela, "Não identificada"), nunca o canal.
  if (filter.origin) conds.push(sql`${SOURCE_EXPR("deals")} = ${filter.origin}`);
  if (filter.q) {
    const like = `%${filter.q.trim().toLowerCase()}%`;
    const digits = filter.q.replace(/\D/g, "");
    conds.push(or(sql`lower(coalesce(${contacts.name}, '')) like ${like}`, digits.length >= 3 ? sql`${contacts.phoneE164} like ${"%" + digits + "%"}` : sql`false`)!);
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
  const st = await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
  const { conds, onlyOwn } = boardConds(filter, viewer);
  const [hours, lateIds] = await Promise.all([getBusinessHours(), lateDealIds(viewer ?? { id: "", role: "gestor" }, { onlyOwn })]);
  const rows = await db.select({
    id: deals.id, contactId: contacts.id, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, contactName: contacts.name, phone: contacts.phoneE164, origin: sql<string>`${SOURCE_EXPR("deals")}`, ownerId: deals.ownerId, ownerName: users.name,
    stageId: deals.stageId, awaitingReplySince: deals.awaitingReplySince, stageEnteredAt: deals.stageEnteredAt, isClient: contacts.isClient,
    scheduledAt: deals.scheduledAt, valueCents: deals.valueCents,
    lastMessage: sql<string | null>`lm.body`, lastMessageKind: sql<string | null>`lm.kind`, lastMessageAt: sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.body, m.kind, m.created_at, m.direction from ${messages} m where m.deal_id = ${deals.id} order by m.created_at desc, m.id desc limit 1) lm`, sql`true`)
    .where(and(...conds))
    .orderBy(sql`${deals.awaitingReplySince} asc nulls last`, desc(deals.stageEnteredAt))
    .limit(600);
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return st.map((s) => {
    const open = s.kind !== "fechado" && s.kind !== "perdido";
    return {
      id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, color: s.color,
      cards: orderByUrgency(rows.filter((r) => r.stageId === s.id).map((r): BoardCard => {
        const waitSeconds = open && r.awaitingReplySince ? businessSecondsBetween(new Date(r.awaitingReplySince).getTime(), now.getTime(), hours) : 0;
        return {
          ...r, awaitingReplySince: iso(r.awaitingReplySince), stageEnteredAt: r.stageEnteredAt.toISOString(),
          lastMessageAt: iso(r.lastMessageAt), scheduledAt: iso(r.scheduledAt), waitSeconds,
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

