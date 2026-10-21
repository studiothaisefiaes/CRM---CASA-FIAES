import { and, desc, eq, isNotNull, isNull, notLike, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, dealEvents, deals } from "../db/schema";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

/** Os avisos de espera do lead: a mesma regra de `recordOutbound` (lembrete de tarefa, `task:<id>`, não é espera). */
export const waitAlertsOf = (dealId: string) => and(isNull(alerts.resolvedAt), or(
  and(eq(alerts.dealId, dealId), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")),
  and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.waitKey)),
  // o aviso "a cliente escreveu": Resolvido é ter cuidado da mensagem
  and(eq(alerts.dealId, dealId), eq(alerts.type, "mensagem_cliente")),
));

/**
 * "Resolvido (não precisa responder)": a última mensagem da cliente não pede resposta ("vou ver e te falo", "já paguei").
 * Encerra a espera sem mandar nada: sai do prazo e dos avisos, a etapa não muda e a conversa continua na Fila (não é "Encerrar conversa").
 * Volta a esperar sozinha quando ela escrever de novo (recordInbound).
 */
export async function resolveWithoutReply(dealId: string, userId: string, now = new Date()): Promise<{ resolved: boolean }> {
  const r = await db.transaction((tx) => resolveWithoutReplyTx(tx, dealId, userId, now));
  if (r.resolved) await emit("lead_atualizado", { dealId });
  return r;
}

/** O mesmo, dentro de uma transação (regras). `userId` nulo = o sistema. Quem chama avisa as telas depois do commit. */
export async function resolveWithoutReplyTx(tx: Tx, dealId: string, userId: string | null, now: Date): Promise<{ resolved: boolean }> {
  const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d || d.closedAt || d.archivedAt) throw new UserFacingError("Essa conversa não está mais aberta.");
  if (!d.awaitingReplySince) return { resolved: false };
  await tx.update(deals).set({ awaitingReplySince: null, resolvedAt: now, resolvedById: userId }).where(eq(deals.id, dealId));
  await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` }).where(waitAlertsOf(dealId));
  await logEvent(tx, dealId, "resolvida", { desde: d.awaitingReplySince.toISOString() }, userId);
  return { resolved: true };
}

/** Desfazer: a espera volta de onde estava. Recusa se a Casa já escreveu ou se a cliente já escreveu de novo. */
export async function undoResolve(dealId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d?.resolvedAt) throw new UserFacingError("Essa conversa não está como resolvida.");
    if (d.lastOutboundAt && d.lastOutboundAt > d.resolvedAt) throw new UserFacingError("A Casa já respondeu depois: não há espera para voltar.");
    if (d.awaitingReplySince) throw new UserFacingError("A cliente já escreveu de novo: a conversa já está esperando resposta.");
    const [ev] = await tx.select({ payload: dealEvents.payload }).from(dealEvents)
      .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resolvida"))).orderBy(desc(dealEvents.createdAt)).limit(1);
    const desde = typeof ev?.payload.desde === "string" ? new Date(ev.payload.desde) : null;
    if (!desde) throw new UserFacingError("Não deu para desfazer: falta o início da espera.");
    await tx.update(deals).set({ awaitingReplySince: desde, resolvedAt: null, resolvedById: null }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "resolvida_desfeita", {}, userId);
  });
  await emit("lead_atualizado", { dealId });
}
