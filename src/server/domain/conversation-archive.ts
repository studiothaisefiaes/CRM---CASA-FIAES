import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, deals } from "../db/schema";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

/**
 * Encerrar (o único jeito de tirar a conversa da lista; antes "Arquivar conversa"): o atendimento terminou. Sai da Fila e da espera (os avisos pendentes se resolvem), sem mudar a etapa nem virar
 * "não é cliente". Volta sozinha quando a cliente escreve de novo ou quando a Casa manda mensagem (ver recordInbound/recordOutbound).
 */
export async function archiveConversation(dealId: string, userId: string): Promise<void> {
  await db.transaction((tx) => archiveConversationTx(tx, dealId, userId, new Date()));
  await afterArchive(dealId);
}

/** Encerrar dentro de uma transação (regras). `userId` nulo = o sistema. Depois do commit, quem chama roda `afterArchive`. */
export async function archiveConversationTx(tx: Tx, dealId: string, userId: string | null, now: Date): Promise<void> {
  const [d] = await tx.update(deals).set({ conversationArchivedAt: now, awaitingReplySince: null })
    .where(and(eq(deals.id, dealId), isNull(deals.closedAt), isNull(deals.archivedAt))).returning({ id: deals.id });
  if (!d) throw new UserFacingError("Essa conversa não está mais aberta.");
  await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
  await logEvent(tx, dealId, "conversa_arquivada", {}, userId);
  // Atendida: só encerra (nova organização, 16/10: sem Fechado). A conversa termina sozinha 3 dias depois (`closeAttendedDeals`).
}

/** Depois do commit do encerramento: avisa as telas e põe na fila a mensagem de encerramento (Lote 4; nasce desligada). Nunca lança. */
export async function afterArchive(dealId: string): Promise<void> {
  await emit("lead_atualizado", { dealId });
  try { const { afterConversationClosed } = await import("./auto-messages"); await afterConversationClosed(dealId); }
  catch (e) { console.error("[mensagem automática] encerramento não enfileirou", dealId, e instanceof Error ? e.message : e); }
}

export async function unarchiveConversation(dealId: string, userId: string): Promise<void> {
  await db.transaction((tx) => unarchiveConversationTx(tx, dealId, userId));
  await emit("lead_atualizado", { dealId });
}

/** Desencerrar dentro de uma transação. `userId` nulo = o sistema. */
export async function unarchiveConversationTx(tx: Tx, dealId: string, userId: string | null): Promise<void> {
  const [d] = await tx.update(deals).set({ conversationArchivedAt: null }).where(eq(deals.id, dealId)).returning({ id: deals.id });
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  await logEvent(tx, dealId, "conversa_desarquivada", { motivo: "manual" }, userId);
}
