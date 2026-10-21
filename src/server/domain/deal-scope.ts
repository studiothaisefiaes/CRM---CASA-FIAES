import { and, eq, inArray, isNull } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { db } from "../db";
import { alerts, auditLog, deals, messages, outbox, settings, tasks } from "../db/schema";
import { UserFacingError } from "./errors";

export type ScopeWho = { id: string; perms: readonly string[] };
export const OUT_OF_SCOPE = "Essa conversa é de outra pessoa da equipe. Peça para ela ou para a gestão transferir.";

/**
 * Chave "Atendente só mexe nas próprias conversas e nas sem dono" (Configurações › Equipe › Perfis). Nasce desligada (pedido da Casa,
 * 17/10: a equipe passa conversas de uma para a outra o tempo todo): desligada, quem tem `atendimento.ver` age em qualquer conversa.
 */
export const STRICT_SCOPE_SETTING = "atendimento_escopo_estrito";
export async function getStrictScope(): Promise<boolean> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, STRICT_SCOPE_SETTING));
  return r?.value === true;
}
export async function setStrictScope(on: boolean, userId: string): Promise<{ on: boolean }> {
  await db.insert(settings).values({ key: STRICT_SCOPE_SETTING, value: on }).onConflictDoUpdate({ target: settings.key, set: { value: on, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: on ? "ligou" : "desligou", entity: "settings", entityId: STRICT_SCOPE_SETTING, data: { on } });
  return { on };
}

/** Vê e mexe nas conversas de todas (a gestão): nenhuma consulta a mais, nada muda para ela. */
const seesAll = (user: ScopeWho) => can(user.perms, "atendimento.todas");

/**
 * Revisão de segurança 17/10 (M1), com a chave acima ligada: a mesma regra das listas (`scopeCond` em queries/queue.ts e `actionableIds` em domain/bulk.ts) vale
 * para as ações de uma conversa. Sem "Ver conversas de todas", só as próprias e as sem dono; a conversa de outra pessoa é recusada.
 * Id inválido ou lead que não existe passam: a própria ação dá o erro dela ("Lead não encontrado", 404…).
 */
export async function assertCanActOnDeal(user: ScopeWho, dealId: string | null | undefined): Promise<void> {
  if (seesAll(user) || !dealId || !isUuid(dealId) || !(await getStrictScope())) return;
  const [d] = await db.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, dealId));
  if (d?.ownerId && d.ownerId !== user.id && !(await handedTo(user.id, dealId))) throw new UserFacingError(OUT_OF_SCOPE);
}

/**
 * A conversa da colega entregue a ela: um aviso ainda não resolvido para ela naquela conversa (a oferta da distribuição "A dona não
 * respondeu. Pode assumir?", a menção em nota "pode conferir o Pix?") ou uma tarefa em aberto para ela. Quem cria aviso e tarefa já
 * tem a conversa no escopo (nota, combinado e retomada passam por aqui), então ninguém se dá acesso sozinha.
 */
const HANDOFF_ALERTS = ["oferta", "mencao"];
async function handedTo(userId: string, dealId: string): Promise<boolean> {
  // Só os avisos que pedem algo a ela: o "mensagem nova" vai para todas e não entrega a conversa a ninguém.
  const [a] = await db.select({ id: alerts.id }).from(alerts)
    .where(and(eq(alerts.dealId, dealId), eq(alerts.userId, userId), inArray(alerts.type, HANDOFF_ALERTS), isNull(alerts.resolvedAt))).limit(1);
  if (a) return true;
  const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.assigneeId, userId), isNull(tasks.doneAt))).limit(1);
  return !!t;
}

/** Ação por mensagem (apagar para todos, marcar ligação): vale o dono da conversa da mensagem. */
export async function assertCanActOnMessage(user: ScopeWho, messageId: string): Promise<void> {
  if (seesAll(user) || !isUuid(messageId) || !(await getStrictScope())) return;
  const [m] = await db.select({ dealId: messages.dealId }).from(messages).where(eq(messages.id, messageId));
  await assertCanActOnDeal(user, m?.dealId);
}

/** Ação por item do outbox (mensagem programada, retomada): vale o dono da conversa do item. */
export async function assertCanActOnOutbox(user: ScopeWho, outboxId: string): Promise<void> {
  if (seesAll(user) || !isUuid(outboxId) || !(await getStrictScope())) return;
  const [o] = await db.select({ dealId: outbox.dealId }).from(outbox).where(eq(outbox.id, outboxId));
  await assertCanActOnDeal(user, o?.dealId);
}
