import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { SOURCE_EXPR } from "../reports/common";
import type { FunilFilter } from "../../lib/report-links";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";

export type BoardCard = {
  id: string; contactId: string; hasAvatar: boolean; contactName: string | null; phone: string; origin: string; ownerId: string | null; ownerName: string | null;
  stageId: string; awaitingReplySince: string | null; stageEnteredAt: string; lastMessage: string | null; lastMessageKind: string | null;
  lastMessageAt: string | null; lastDirection: "in" | "out" | null; isClient: boolean; scheduledAt: string | null; valueCents: number | null;
};
export type BoardStage = { id: string; key: string; name: string; kind: string; slaMinutes: number | null; color: string; cards: BoardCard[] };

/** Filtros vindos dos relatórios (drill-down): lista só os leads daquele número. */
export type BoardFilter = { ownerId?: string | null; origin?: string | null; q?: string | null; filtro?: FunilFilter | null; etapa?: string | null;
  /** Origem real (a mesma dos relatórios, com "Não identificada"). */ source?: string | null };

export async function getBoard(filter: BoardFilter = {}): Promise<BoardStage[]> {
  const st = await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const conds = [or(isNull(deals.closedAt), gte(deals.closedAt, since30))!, isNull(deals.archivedAt)];
  if (filter.ownerId && /^[0-9a-f-]{36}$/i.test(filter.ownerId)) conds.push(eq(deals.ownerId, filter.ownerId));
  if (filter.origin) conds.push(eq(deals.origin, filter.origin));
  if (filter.q) {
    const like = `%${filter.q.trim().toLowerCase()}%`;
    const digits = filter.q.replace(/\D/g, "");
    conds.push(or(sql`lower(coalesce(${contacts.name}, '')) like ${like}`, digits.length >= 3 ? sql`${contacts.phoneE164} like ${"%" + digits + "%"}` : sql`false`)!);
  }
  if (filter.filtro === "atrasados") {
    // Mesma regra do contador de atrasados: alerta de espera aberto (que não é de tarefa), sem contato ignorado.
    conds.push(sql`exists (select 1 from alerts al where al.deal_id = ${deals.id} and al.wait_key is not null and al.wait_key not like 'task:%' and al.resolved_at is null)`, eq(contacts.ignored, false));
  } else if (filter.filtro === "esperando") {
    conds.push(isNotNull(deals.awaitingReplySince), isNull(deals.closedAt), eq(contacts.ignored, false));
  } else if (filter.filtro === "parados") {
    conds.push(isNull(deals.closedAt), eq(contacts.ignored, false),
      sql`exists (select 1 from stages ps where ps.id = ${deals.stageId} and ps.stale_days is not null and ${deals.stageEnteredAt} <= now() - make_interval(days => ps.stale_days))`);
  }
  if (filter.source) conds.push(sql`${SOURCE_EXPR("deals")} = ${filter.source}`);
  if (filter.etapa && /^[a-z0-9_]{1,40}$/i.test(filter.etapa)) conds.push(sql`exists (select 1 from stages es where es.id = ${deals.stageId} and es.key = ${filter.etapa})`);
  const rows = await db.select({
    id: deals.id, contactId: contacts.id, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, contactName: contacts.name, phone: contacts.phoneE164, origin: deals.origin, ownerId: deals.ownerId, ownerName: users.name,
    stageId: deals.stageId, awaitingReplySince: deals.awaitingReplySince, stageEnteredAt: deals.stageEnteredAt, isClient: contacts.isClient,
    scheduledAt: deals.scheduledAt, valueCents: deals.valueCents,
    lastMessage: sql<string | null>`lm.body`, lastMessageKind: sql<string | null>`lm.kind`, lastMessageAt: sql<Date | null>`lm.created_at`, lastDirection: sql<"in" | "out" | null>`lm.direction`,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(sql`lateral (select m.body, m.kind, m.created_at, m.direction from ${messages} m where m.deal_id = ${deals.id} order by m.created_at desc limit 1) lm`, sql`true`)
    .where(and(...conds))
    .orderBy(sql`${deals.awaitingReplySince} asc nulls last`, desc(deals.stageEnteredAt))
    .limit(600);
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return st.map((s) => ({
    id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, color: s.color,
    cards: rows.filter((r) => r.stageId === s.id).map((r) => ({
      ...r, awaitingReplySince: iso(r.awaitingReplySince), stageEnteredAt: r.stageEnteredAt.toISOString(),
      lastMessageAt: iso(r.lastMessageAt), scheduledAt: iso(r.scheduledAt),
    })),
  }));
}

export async function getOrigins() {
  const rows = await db.selectDistinct({ origin: deals.origin }).from(deals);
  return rows.map((r) => r.origin).sort();
}

