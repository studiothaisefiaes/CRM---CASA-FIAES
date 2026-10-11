import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, leadSources, lists, messages, stages, tasks, users, channels } from "../db/schema";
import { SOURCE_EXPR } from "../reports/common";
import { NOT_IDENTIFIED } from "../../lib/source-kinds";
import { HISTORY_EVENT_LIMIT } from "../../lib/history";

// O nó de mídia (com miniatura) fica no servidor; a tela pede o arquivo em /api/media/[id].
const { media: _media, ...msgCols } = getTableColumns(messages);

/** O histórico não repete a conversa: mensagens e "lido" ficam fora (e não gastam o limite). */
const CONVERSATION_EVENTS = ["mensagem_recebida", "mensagem_enviada", "lido"];

export async function getDealDetail(id: string) {
  const [row] = await db.select({ deal: deals, contact: contacts, stage: stages, ownerName: users.name, channelName: channels.name, channelStatus: channels.status })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId)).leftJoin(channels, eq(channels.id, deals.channelId))
    .where(eq(deals.id, id)).limit(1);
  if (!row) return null;
  const assignee = alias(users, "assignee");
  const [msgs, events, listRows, people, stageList, history, [src], [nextAction], sourceRows] = await Promise.all([
    db.select({ m: msgCols, sender: users.name, hasMedia: sql<boolean>`(${messages.media} is not null or ${messages.mediaPath} is not null)` })
      .from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(eq(messages.contactId, row.contact.id)).orderBy(desc(messages.createdAt)).limit(200),
    db.select({ e: dealEvents, user: users.name }).from(dealEvents).leftJoin(users, eq(users.id, dealEvents.userId))
      .where(and(eq(dealEvents.dealId, id), notInArray(dealEvents.type, CONVERSATION_EVENTS))).orderBy(desc(dealEvents.createdAt)).limit(HISTORY_EVENT_LIMIT),
    db.select().from(lists).where(eq(lists.active, true)).orderBy(asc(lists.position)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
    db.select({ id: deals.id, createdAt: deals.createdAt, closedAt: deals.closedAt, stage: stages.name, valueCents: deals.valueCents })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(eq(deals.contactId, row.contact.id))).orderBy(desc(deals.createdAt)).limit(10),
    // A mesma origem da Fila e dos relatórios: `source_label` (link/QR/evidência); sem ela, "Não identificada". Nunca o canal ("WhatsApp").
    db.select({ label: sql<string>`${SOURCE_EXPR("deals")}` }).from(deals).where(eq(deals.id, id)),
    // A próxima ação: UMA aberta por lead (a mais próxima, se houver legado com mais de uma).
    db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, assigneeId: tasks.assigneeId, assigneeName: assignee.name }).from(tasks)
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1),
    db.select({ id: leadSources.id, label: leadSources.label, active: leadSources.active }).from(leadSources).orderBy(asc(leadSources.label)),
  ]);
  return {
    ...row,
    messages: msgs.reverse().map(({ m, sender, hasMedia }) => ({ ...m, sender, hasMedia })),
    events: events.map(({ e, user }) => ({ ...e, user })),
    objections: listRows.filter((l) => l.kind === "objection"),
    lostReasons: listRows.filter((l) => l.kind === "lost_reason"),
    quickReplies: listRows.filter((l) => l.kind === "quick_reply"),
    origins: listRows.filter((l) => l.kind === "origin"),
    services: listRows.filter((l) => l.kind === "service"),
    sourceLabel: src?.label ?? NOT_IDENTIFIED,
    nextAction: nextAction ?? null,
    /** Origens de link/QR (para o "Como conheceu?" e para o nome nas mudanças do histórico). */
    sources: sourceRows,
    people, stages: stageList, history: history.filter((h) => h.id !== id),
  };
}
export type DealDetail = NonNullable<Awaited<ReturnType<typeof getDealDetail>>>;

/** O que as folhas de agendar, fechar venda e perdido precisam do lead (usado ao soltar um card do Quadro): sem a conversa, o histórico nem os dados do contato. */
export type SheetDeal = Pick<DealDetail, "deal" | "stage" | "stages" | "services" | "lostReasons" | "people"> & { nextAction: DealDetail["nextAction"] | null };
export async function getDealSheetData(id: string): Promise<SheetDeal | null> {
  const [row] = await db.select({ deal: deals, stage: stages }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)).limit(1);
  if (!row) return null;
  const [listRows, people, stageList] = await Promise.all([
    db.select().from(lists).where(and(eq(lists.active, true), inArray(lists.kind, ["service", "lost_reason"]))).orderBy(asc(lists.position)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
  ]);
  return { ...row, services: listRows.filter((l) => l.kind === "service"), lostReasons: listRows.filter((l) => l.kind === "lost_reason"), people, stages: stageList, nextAction: null };
}
