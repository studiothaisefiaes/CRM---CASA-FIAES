import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { dealEvents, deals } from "../db/schema";
import { conversationStatus, type ConversationStatus } from "../../lib/conversation-status";
import { afterArchive, archiveConversationTx, unarchiveConversationTx } from "./conversation-archive";
import { resolveWithoutReplyTx } from "./resolve";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

export async function conversationStatusOf(dealId: string): Promise<ConversationStatus> {
  const [d] = await db.select({ archivedAt: deals.conversationArchivedAt, awaitingSince: deals.awaitingReplySince }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  return conversationStatus(d);
}

/**
 * Troca o status (seletor do cabeçalho; regras com `userId` nulo = Sistema). Por baixo:
 * - Resolvido: resolve a conversa (o antigo Encerrar; sai da lista e volta sozinha se a cliente escrever);
 * - Aguardando: reabre se estava resolvida e tira a espera e os avisos (não precisa responder);
 * - Aberto: reabre se estava resolvida e volta a esperar a Casa (a espera de antes, se foi tirada à mão e ninguém escreveu; senão, agora).
 */
export async function setConversationStatus(dealId: string, to: ConversationStatus, userId: string | null, now = new Date()): Promise<{ changed: boolean; before: ConversationStatus }> {
  const r = await db.transaction((tx) => setConversationStatusTx(tx, dealId, to, userId, now));
  if (r.changed) await afterConversationStatus(dealId, r);
  return { changed: r.changed, before: r.before };
}

export type StatusChange = { changed: boolean; before: ConversationStatus; archived: boolean };

/** O mesmo, dentro de uma transação (regras). Depois do commit, quem chama roda `afterConversationStatus` se mudou. */
export async function setConversationStatusTx(tx: Tx, dealId: string, to: ConversationStatus, userId: string | null, now: Date): Promise<StatusChange> {
  const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d || d.closedAt || d.archivedAt) throw new UserFacingError("Essa conversa não está mais aberta.");
  const before = conversationStatus({ archivedAt: d.conversationArchivedAt, awaitingSince: d.awaitingReplySince });
  if (before === to) return { changed: false, before, archived: false };
  if (to === "resolvido") { await archiveConversationTx(tx, dealId, userId, now); return { changed: true, before, archived: true }; }
  if (d.conversationArchivedAt) await unarchiveConversationTx(tx, dealId, userId);
  if (to === "aguardando") {
    if (d.awaitingReplySince) await resolveWithoutReplyTx(tx, dealId, userId, now);
  } else {
    // A espera tirada à mão (Aguardando) e ninguém escreveu depois: volta a de antes; senão, começa agora.
    let since = now;
    if (d.resolvedAt && !(d.lastOutboundAt && d.lastOutboundAt > d.resolvedAt) && !d.conversationArchivedAt) {
      const [ev] = await tx.select({ payload: dealEvents.payload }).from(dealEvents)
        .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resolvida"))).orderBy(desc(dealEvents.createdAt)).limit(1);
      if (typeof ev?.payload.desde === "string") since = new Date(ev.payload.desde);
    }
    await tx.update(deals).set({ awaitingReplySince: sql`coalesce(${deals.awaitingReplySince}, ${since.toISOString()}::timestamptz)`, resolvedAt: null, resolvedById: null }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "resolvida_desfeita", { status: "aberto" }, userId);
  }
  return { changed: true, before, archived: false };
}

/** Depois do commit: avisa as telas; Resolvido também põe na fila a mensagem de encerramento (se ligada). */
export async function afterConversationStatus(dealId: string, r: Pick<StatusChange, "archived">): Promise<void> {
  if (r.archived) await afterArchive(dealId);
  else await emit("lead_atualizado", { dealId });
}
