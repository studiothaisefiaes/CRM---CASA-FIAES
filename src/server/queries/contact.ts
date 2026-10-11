import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { contacts, dealEvents, deals, leadSources, lists, messages, stages, tasks, users } from "../db/schema";
import { SOURCE_EXPR } from "../reports/common";
import { NOT_IDENTIFIED } from "../../lib/source-kinds";
import { HISTORY_EVENT_LIMIT, type HistoryLookup } from "../../lib/history";
import { isUuid } from "../../lib/uuid";

export const CONTACT_MESSAGE_LIMIT = 200;
const CONTACT_DEAL_LIMIT = 100, CONTACT_TASK_LIMIT = 100;
/** A conversa já mostra estes; no histórico do contato eles entram como mensagens, não como eventos. */
const CONVERSATION_EVENTS = ["mensagem_recebida", "mensagem_enviada", "lido"];

export type ContactDeal = {
  id: string; createdAt: Date; closedAt: Date | null; archivedAt: Date | null; scheduledAt: Date | null;
  stageKey: string; stageName: string; stageKind: string; ownerId: string | null; ownerName: string | null; sourceLabel: string;
  /** Em andamento: nem fechado, nem perdido, nem arquivado. */
  open: boolean; archived: boolean;
  /** Só para a gestão (`withValues`); para a atendente é sempre null. */
  valueCents: number | null;
};
export type ContactTask = { id: string; dealId: string | null; kind: string; title: string; dueAt: Date; doneAt: Date | null; assigneeName: string | null };
export type ContactMessage = { id: string; direction: "in" | "out"; kind: string; body: string | null; createdAt: Date; sender: string | null; fromPhone: boolean; deleted: boolean; dealId: string | null };

/**
 * A ficha do contato: tudo que a Casa sabe dele. Abre qualquer contato, inclusive "Não é cliente" (a ficha mostra o estado).
 * - `deals`: todos os leads (abertos, fechados, perdidos e arquivados), do mais novo ao mais antigo.
 * - `messages`: as últimas 200 de todos os leads, em ordem de leitura (`messageTotal` diz quantas existem).
 * - `events`: a auditoria dos leads do contato, sem as mensagens (que já estão em `messages`).
 * - `origin`: a origem real do primeiro lead, ou "Não identificada".
 * - `values` (vendas e total gasto): só com `withValues` (gestão). Sem isso, nem o valor de cada lead sai.
 */
export async function getContact(id: string, opts: { withValues?: boolean } = {}) {
  if (!isUuid(id)) return null;
  const [contact] = await db.select({
    id: contacts.id, name: contacts.name, phone: contacts.phoneE164, email: contacts.email, instagram: contacts.instagram, notes: contacts.notes,
    isClient: contacts.isClient, clientSince: contacts.clientSince, lastServiceAt: contacts.lastServiceAt, ignored: contacts.ignored,
    hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, createdAt: contacts.createdAt,
  }).from(contacts).where(eq(contacts.id, id));
  if (!contact) return null;

  const assignee = alias(users, "assignee");
  const [dealRows, msgRows, [msgCount], taskRows, listRows, userRows, sourceRows, stageRows] = await Promise.all([
    db.select({
      id: deals.id, createdAt: deals.createdAt, closedAt: deals.closedAt, archivedAt: deals.archivedAt, scheduledAt: deals.scheduledAt,
      stageKey: stages.key, stageName: stages.name, stageKind: stages.kind, ownerId: deals.ownerId, ownerName: users.name, valueCents: deals.valueCents,
      sourceLabel: sql<string>`${SOURCE_EXPR("deals")}`,
    }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(users, eq(users.id, deals.ownerId))
      .where(eq(deals.contactId, id)).orderBy(desc(deals.createdAt)).limit(CONTACT_DEAL_LIMIT),
    db.select({ m: messages, sender: users.name }).from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(eq(messages.contactId, id)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(CONTACT_MESSAGE_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.contactId, id)),
    db.select({ id: tasks.id, dealId: tasks.dealId, kind: tasks.kind, title: tasks.title, dueAt: tasks.dueAt, doneAt: tasks.doneAt, assigneeName: assignee.name })
      .from(tasks).leftJoin(assignee, eq(assignee.id, tasks.assigneeId)).where(eq(tasks.contactId, id)).orderBy(asc(sql`${tasks.doneAt} is not null`), asc(tasks.dueAt)).limit(CONTACT_TASK_LIMIT),
    db.select({ id: lists.id, label: lists.label }).from(lists),
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ id: leadSources.id, label: leadSources.label }).from(leadSources),
    db.select({ key: stages.key, name: stages.name }).from(stages),
  ]);

  const dealIds = dealRows.map((d) => d.id);
  const eventRows = dealIds.length
    ? await db.select({ e: dealEvents, user: users.name }).from(dealEvents).leftJoin(users, eq(users.id, dealEvents.userId))
        .where(and(inArray(dealEvents.dealId, dealIds), notInArray(dealEvents.type, CONVERSATION_EVENTS))).orderBy(desc(dealEvents.createdAt)).limit(HISTORY_EVENT_LIMIT)
    : [];

  const dealsOut: ContactDeal[] = dealRows.map((d) => ({
    ...d, open: !d.archivedAt && !d.closedAt && d.stageKind !== "fechado" && d.stageKind !== "perdido", archived: !!d.archivedAt,
    valueCents: opts.withValues ? d.valueCents : null,
  }));
  const sales = dealRows.filter((d) => d.stageKind === "fechado" && !d.archivedAt);
  const lookup: HistoryLookup = {
    users: Object.fromEntries(userRows.map((u) => [u.id, u.name])), lists: Object.fromEntries(listRows.map((l) => [l.id, l.label])),
    sources: Object.fromEntries(sourceRows.map((s) => [s.id, s.label])), stages: Object.fromEntries(stageRows.map((s) => [s.key, s.name])),
  };
  return {
    contact,
    /** O relógio do servidor no momento da consulta (a tela calcula "atrasada" e "hoje" com ele, sem ler o relógio na renderização). */
    asOf: Date.now(),
    /** Como a cliente conheceu a Casa, pelo primeiro lead. */
    origin: dealRows.at(-1)?.sourceLabel ?? NOT_IDENTIFIED,
    deals: dealsOut,
    messages: msgRows.reverse().map(({ m, sender }): ContactMessage => ({
      id: m.id, direction: m.direction, kind: m.kind, body: m.body, createdAt: m.createdAt, sender, fromPhone: m.fromPhone, deleted: !!m.deletedAt, dealId: m.dealId,
    })),
    messageTotal: msgCount?.n ?? 0,
    tasks: taskRows as ContactTask[],
    events: eventRows.map(({ e, user }) => ({ id: e.id, dealId: e.dealId, type: e.type, payload: e.payload, createdAt: e.createdAt, user })),
    eventsTruncated: eventRows.length >= HISTORY_EVENT_LIMIT,
    lookup,
    values: opts.withValues ? { sales: sales.length, totalCents: sales.reduce((n, d) => n + (d.valueCents ?? 0), 0) } : null,
  };
}
export type ContactDetail = NonNullable<Awaited<ReturnType<typeof getContact>>>;
