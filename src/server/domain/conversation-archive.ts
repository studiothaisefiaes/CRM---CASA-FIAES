import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, deals, tasks } from "../db/schema";
import { stopAttemptsTx } from "./attempts";
import { completeTaskTx } from "./tasks";
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
  await closeOverdueResumesTx(tx, dealId, userId, now);
  await logEvent(tx, dealId, "conversa_arquivada", {}, userId);
  // Atendida: só encerra (nova organização, 16/10: sem Fechado). A conversa termina sozinha 3 dias depois (`closeAttendedDeals`).
}

/**
 * Resolver encerra a retomada que já venceu (Cati 31/10, Camilla: Resolvido e a etiqueta "venceu 18/10" sem sair de jeito nenhum).
 * A retomada com data à frente continua: é o combinado de voltar a falar (caso Aline, 20/10).
 */
export async function closeOverdueResumesTx(tx: Tx, dealId: string, userId: string | null, now: Date): Promise<number> {
  const overdue = await tx.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt), lt(tasks.dueAt, now)));
  if (!overdue.length) return 0;
  const [d] = await tx.select().from(deals).where(eq(deals.id, dealId));
  if (d?.followupTaskId && overdue.some((t) => t.id === d.followupTaskId)) await stopAttemptsTx(tx, d, userId, now);
  for (const t of overdue) await completeTaskTx(tx, t.id, userId, "cancelada", now);
  return overdue.length;
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
