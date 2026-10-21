import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealFollows, deals } from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncaoLigada, funcaoLigada } from "./funcoes";
import { emit } from "./events";

/**
 * "Marcar como não lida": a conversa volta para Não lidas na Fila até alguém abrir (a abertura limpa em `markSeen`).
 * Sem som e sem aviso no sino: só avisa as telas para a bolinha aparecer.
 */
export async function markUnread(dealId: string, userId: string, now = new Date()): Promise<void> {
  await assertFuncaoLigada("marcar_nao_lida");
  const rows = await db.update(deals).set({ markedUnreadAt: now, markedUnreadBy: userId }).where(eq(deals.id, dealId)).returning({ id: deals.id });
  if (!rows.length) throw new UserFacingError("Conversa não encontrada.");
  await emit("conversa_lida", { dealId });
}

/** Acompanhar / deixar de acompanhar: lista pessoal, por pessoa. Deixar de acompanhar nunca é recusado (nem com a função desligada). */
export async function setFollowing(dealId: string, userId: string, on: boolean): Promise<void> {
  if (on) {
    await assertFuncaoLigada("acompanhar");
    const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
    if (!d) throw new UserFacingError("Conversa não encontrada.");
    await db.insert(dealFollows).values({ userId, dealId }).onConflictDoNothing();
  } else {
    await db.delete(dealFollows).where(and(eq(dealFollows.userId, userId), eq(dealFollows.dealId, dealId)));
  }
}

export type Following = { dealId: string; name: string; lastAt: string | null; waiting: boolean };

/** As conversas que esta pessoa acompanha (também as resolvidas), a mais recente primeiro. Função desligada: lista vazia. */
export async function followingOf(userId: string): Promise<Following[]> {
  if (!(await funcaoLigada("acompanhar"))) return [];
  const rows = await db.select({
    dealId: deals.id, name: contacts.name, phone: contacts.phoneE164, awaiting: deals.awaitingReplySince,
    lastAt: sql<Date | null>`(select max(m.created_at) from messages m where m.deal_id = ${deals.id} and m.deleted_at is null)`,
  }).from(dealFollows).innerJoin(deals, eq(deals.id, dealFollows.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(eq(dealFollows.userId, userId)).orderBy(sql`2 desc nulls last`, desc(dealFollows.createdAt)).limit(100);
  return rows.map((r) => ({ dealId: r.dealId, name: r.name?.trim() || r.phone, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null, waiting: !!r.awaiting }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}
