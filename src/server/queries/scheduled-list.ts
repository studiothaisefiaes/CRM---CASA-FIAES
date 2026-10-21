import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { contacts, deals, outbox, tasks, users } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { can } from "@/lib/permissions";
import { SCHEDULED_SOURCE } from "../domain/scheduled";
import { EDITED_ERROR } from "../domain/retomada";

/**
 * "Mensagens programadas" (Atendimento › Programadas, pedido do dono 16/10): as mensagens que vão sair sozinhas (outbox "agendada" pendente,
 * a maioria ligada a uma retomada por `options.taskId`) e as que não saíram nas últimas 24 h (canceladas ou com falha).
 * Escopo igual ao da Fila: sem "Ver conversas de todas", só as conversas dela e as sem dono, mais as que ela mesma programou.
 */
export type ScheduledRange = "hoje" | "7d" | "todas";
export type ScheduledRow = {
  id: string; dealId: string; contactId: string; name: string; hasAvatar: boolean; avatarV: string | null;
  text: string; sendAt: string; status: "pending" | "sending" | "sent" | "failed" | "cancelled"; error: string | null; statusAt: string | null;
  authorId: string | null; authorName: string | null; cancelIfReply: boolean; motivo: string | null;
  /** Ligada a uma retomada ainda aberta (cancelar a mensagem deixa o lembrete). */ hasReminder: boolean;
};
export type ScheduledList = { pending: ScheduledRow[]; recent: ScheduledRow[]; total: number };

type Who = Pick<SessionUser, "id" | "perms">;
const OFFSET = 3 * 3_600_000;
const isScheduled = sql`${outbox.options}->>'source' = ${SCHEDULED_SOURCE}`;
const SEND_AT = sql<Date>`coalesce((${outbox.options}->>'sendAt')::timestamptz, ${outbox.notBefore})`;
const author = alias(users, "autora");

/** Sem "Ver conversas de todas": as conversas dela, as sem dono e as que ela programou. */
export const scheduledScope = (user: Who): SQL | undefined =>
  can(user.perms, "atendimento.todas") ? undefined : or(eq(deals.ownerId, user.id), sql`${deals.ownerId} is null`, eq(outbox.createdBy, user.id));

const endOfBahiaDay = (now: Date) => {
  const l = new Date(now.getTime() - OFFSET);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 1) + OFFSET);
};

function select() {
  return db.select({
    id: outbox.id, dealId: outbox.dealId, contactId: contacts.id, name: contacts.name, nickname: contacts.nickname,
    hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`,
    avatarV: sql<string | null>`case when ${contacts.avatarPath} is not null then coalesce(floor(extract(epoch from ${contacts.avatarCheckedAt}))::bigint::text, '0') end`,
    text: outbox.text, sendAt: SEND_AT, status: outbox.status, error: outbox.error, statusAt: outbox.statusAt, createdAt: outbox.createdAt,
    authorId: outbox.createdBy, authorName: author.name, cancelIfReply: sql<boolean>`coalesce((${outbox.options}->>'cancelIfReply')::boolean, true)`,
    motivo: tasks.title, taskOpen: sql<boolean>`(${tasks.id} is not null and ${tasks.doneAt} is null)`,
  }).from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(author, eq(author.id, outbox.createdBy))
    .leftJoin(tasks, sql`${tasks.id}::text = ${outbox.options}->>'taskId'`);
}
type Raw = Awaited<ReturnType<ReturnType<typeof select>["where"]>>[number];
const toRow = (r: Raw): ScheduledRow => ({
  id: r.id, dealId: r.dealId, contactId: r.contactId, name: (r.nickname?.trim() || r.name?.trim() || "Sem nome"), hasAvatar: r.hasAvatar, avatarV: r.avatarV,
  text: r.text, sendAt: new Date(r.sendAt).toISOString(), status: r.status as ScheduledRow["status"], error: r.error, statusAt: r.statusAt?.toISOString() ?? null,
  authorId: r.authorId, authorName: r.authorName, cancelIfReply: r.cancelIfReply,
  motivo: r.motivo && r.motivo !== "Mensagem programada" ? r.motivo : null, hasReminder: !!r.taskOpen,
});

export async function listScheduled(user: Who, opts: { mine?: boolean; range?: ScheduledRange; q?: string | null; now?: Date } = {}): Promise<ScheduledList> {
  const now = opts.now ?? new Date();
  const scope = scheduledScope(user);
  const mine = opts.mine ? eq(outbox.createdBy, user.id) : undefined;
  const q = opts.q?.trim() ? or(ilike(contacts.name, `%${opts.q.trim()}%`), ilike(contacts.nickname, `%${opts.q.trim()}%`)) : undefined;
  const until = opts.range === "hoje" ? endOfBahiaDay(now) : opts.range === "7d" ? new Date(now.getTime() + 7 * 86_400_000) : null;
  const [pending, recent, [{ n }]] = await Promise.all([
    select().where(and(isScheduled, inArray(outbox.status, ["pending", "sending"]), scope, mine, q, until ? lt(SEND_AT, until) : undefined)).orderBy(asc(SEND_AT), asc(outbox.id)).limit(500),
    select().where(and(isScheduled, inArray(outbox.status, ["failed", "cancelled"]), sql`${outbox.error} is distinct from ${EDITED_ERROR}`, gte(sql`coalesce(${outbox.statusAt}, ${outbox.createdAt})`, new Date(now.getTime() - 86_400_000)), scope, mine, q))
      .orderBy(desc(sql`coalesce(${outbox.statusAt}, ${outbox.createdAt})`)).limit(100),
    countScheduledRaw(user),
  ]);
  return { pending: pending.map(toRow), recent: recent.map(toRow), total: n };
}

function countScheduledRaw(user: Who) {
  return db.select({ n: sql<number>`count(*)::int` }).from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId))
    .where(and(isScheduled, eq(outbox.status, "pending"), scheduledScope(user)));
}
/** O número da aba "Programadas" (todas as pendentes que ela pode ver). */
export async function countScheduled(user: Who): Promise<number> {
  return (await countScheduledRaw(user))[0]?.n ?? 0;
}

/** Ela pode mexer nesta mensagem (editar, cancelar, desfazer)? Mesmo escopo da lista. */
export async function canTouchScheduled(user: Who, outboxId: string): Promise<{ dealId: string } | null> {
  const [r] = await db.select({ dealId: outbox.dealId }).from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId))
    .where(and(eq(outbox.id, outboxId), isScheduled, scheduledScope(user)));
  return r ?? null;
}
