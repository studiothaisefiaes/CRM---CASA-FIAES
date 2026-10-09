import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";

export type BoardCard = {
  id: string; contactName: string | null; phone: string; origin: string; ownerId: string | null; ownerName: string | null;
  stageId: string; awaitingReplySince: string | null; stageEnteredAt: string; lastMessage: string | null; lastMessageKind: string | null;
  lastMessageAt: string | null; lastDirection: "in" | "out" | null; isClient: boolean; scheduledAt: string | null; valueCents: number | null;
};
export type BoardStage = { id: string; key: string; name: string; kind: string; slaMinutes: number | null; color: string; cards: BoardCard[] };

export async function getBoard(filter: { ownerId?: string | null; origin?: string | null; q?: string | null } = {}): Promise<BoardStage[]> {
  const st = await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const conds = [or(isNull(deals.closedAt), gte(deals.closedAt, since30))!];
  if (filter.ownerId) conds.push(eq(deals.ownerId, filter.ownerId));
  if (filter.origin) conds.push(eq(deals.origin, filter.origin));
  if (filter.q) {
    const like = `%${filter.q.trim().toLowerCase()}%`;
    const digits = filter.q.replace(/\D/g, "");
    conds.push(or(sql`lower(coalesce(${contacts.name}, '')) like ${like}`, digits.length >= 3 ? sql`${contacts.phoneE164} like ${"%" + digits + "%"}` : sql`false`)!);
  }
  const last = db.select({
    dealId: messages.dealId, body: messages.body, kind: messages.kind, createdAt: messages.createdAt, direction: messages.direction,
    rn: sql<number>`row_number() over (partition by ${messages.dealId} order by ${messages.createdAt} desc)`.as("rn"),
  }).from(messages).as("last");
  const rows = await db.select({
    id: deals.id, contactName: contacts.name, phone: contacts.phoneE164, origin: deals.origin, ownerId: deals.ownerId, ownerName: users.name,
    stageId: deals.stageId, awaitingReplySince: deals.awaitingReplySince, stageEnteredAt: deals.stageEnteredAt, isClient: contacts.isClient,
    scheduledAt: deals.scheduledAt, valueCents: deals.valueCents,
    lastMessage: last.body, lastMessageKind: last.kind, lastMessageAt: last.createdAt, lastDirection: last.direction,
  }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(last, and(eq(last.dealId, deals.id), eq(last.rn, 1)))
    .where(and(...conds))
    .orderBy(sql`${deals.awaitingReplySince} asc nulls last`, desc(deals.stageEnteredAt))
    .limit(600);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
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

