import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, lists, messages, stages, users, channels } from "../db/schema";

// O nó de mídia (com miniatura) fica no servidor; a tela pede o arquivo em /api/media/[id].
const { media: _media, ...msgCols } = getTableColumns(messages);

export async function getDealDetail(id: string) {
  const [row] = await db.select({ deal: deals, contact: contacts, stage: stages, ownerName: users.name, channelName: channels.name, channelStatus: channels.status })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId)).leftJoin(channels, eq(channels.id, deals.channelId))
    .where(eq(deals.id, id)).limit(1);
  if (!row) return null;
  const [msgs, events, listRows, people, stageList, history] = await Promise.all([
    db.select({ m: msgCols, sender: users.name, hasMedia: sql<boolean>`(${messages.media} is not null or ${messages.mediaPath} is not null)` })
      .from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(eq(messages.contactId, row.contact.id)).orderBy(desc(messages.createdAt)).limit(200),
    db.select({ e: dealEvents, user: users.name }).from(dealEvents).leftJoin(users, eq(users.id, dealEvents.userId))
      .where(eq(dealEvents.dealId, id)).orderBy(desc(dealEvents.createdAt)).limit(80),
    db.select().from(lists).where(eq(lists.active, true)).orderBy(asc(lists.position)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
    db.select({ id: deals.id, createdAt: deals.createdAt, closedAt: deals.closedAt, stage: stages.name, valueCents: deals.valueCents })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(eq(deals.contactId, row.contact.id))).orderBy(desc(deals.createdAt)).limit(10),
  ]);
  return {
    ...row,
    messages: msgs.reverse().map(({ m, sender, hasMedia }) => ({ ...m, sender, hasMedia })),
    events: events.map(({ e, user }) => ({ ...e, user })),
    objections: listRows.filter((l) => l.kind === "objection"),
    lostReasons: listRows.filter((l) => l.kind === "lost_reason"),
    quickReplies: listRows.filter((l) => l.kind === "quick_reply"),
    origins: listRows.filter((l) => l.kind === "origin"),
    people, stages: stageList, history: history.filter((h) => h.id !== id),
  };
}
export type DealDetail = NonNullable<Awaited<ReturnType<typeof getDealDetail>>>;
