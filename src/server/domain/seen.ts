import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "../db";
import { deals } from "../db/schema";
import { emit } from "./events";
import { resolveClientMessageAlerts } from "./client-message-alert";
import { can } from "@/lib/permissions";

/**
 * Abrir a conversa marca como vista (`seen_at`): as mensagens da cliente até agora deixam de ser "não lidas" na Fila.
 * Vale para quem abrir, dona ou não (pedido da Casa 16/10: a conversa aberta na tela é conversa lida; antes só a dona marcava e o "1" ficava para quem cobria).
 * Avisa a Fila (só o escopo `queue`), para a bolinha sumir também nas outras telas.
 */
export async function markSeen(dealId: string, _userId: string, now = new Date()): Promise<void> {
  const rows = await db.update(deals).set({ seenAt: now, markedUnreadAt: null, markedUnreadBy: null })
    // Só quando há o que marcar (nunca aberta, ou chegou mensagem depois): abrir de novo não acorda as outras telas.
    .where(and(eq(deals.id, dealId), or(isNull(deals.seenAt), lt(deals.seenAt, deals.lastInboundAt), isNotNull(deals.markedUnreadAt))))
    .returning({ id: deals.id });
  // Vista: o aviso "a cliente escreveu" sai do sino (mesmo quando o visto já estava em dia, ex.: aberta antes do aviso chegar).
  await resolveClientMessageAlerts(dealId, now);
  if (rows.length) await emit("conversa_lida", { dealId });
}

/** Gestão que também recebe conversas (a Cati atende a recepção, 29/10) é colega cobrindo: abrir marca como lida. */
export const peeks = (perms: readonly string[]) => can(perms, "alertas.escalada") && !can(perms, "distribuicao.receber");

/**
 * "Espiar sem assumir" (pesquisa 20/10; Huggy e o modo espião do ChatGuru): a gestão (quem recebe escaladas) que abre a conversa de uma
 * atendente NÃO marca como lida para a dona: a bolinha de não lida e o aviso "a cliente escreveu" continuam com ela. Responder marca.
 * Colega da recepção cobrindo continua marcando (pedido da Casa 16/10); conversa sem dona também (ninguém para avisar).
 * O visto azul do WhatsApp já seguia esta regra (`markConversationRead`: só a dona ou quem responde).
 */
export async function isPeek(user: { id: string; perms: readonly string[] }, dealId: string): Promise<boolean> {
  if (!peeks(user.perms)) return false;
  const [d] = await db.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, dealId));
  return !!d?.ownerId && d.ownerId !== user.id;
}
