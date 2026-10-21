import { and, eq, isNull, like } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, auditLog, contacts, deals, users } from "../db/schema";
import { alertText, clientLabel } from "../../lib/alert-copy";
import { openOfferFor } from "./offers";
import { emit, logEvent } from "./events";
import { updateDealTx } from "./updates";
import { reassignWaitAlerts } from "./wait-alerts";
import { UserFacingError } from "./errors";
import { canReceiveConversation } from "./team-scope";

/** "Assumir": a pessoa logada passa a ser a responsável pelo lead. Quem responde pelo celular conectado conta como ela. */
export async function claimDeal(dealId: string, userId: string): Promise<{ previousOwnerId: string | null }> {
  const previousOwnerId = await db.transaction(async (tx) => {
    const [deal] = await tx.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, dealId)).for("update");
    if (!deal) throw new Error("Conversa não encontrada");
    if (deal.ownerId === userId) return deal.ownerId;
    const porOferta = await openOfferFor(dealId, userId, tx);
    await tx.update(deals).set({ ownerId: userId }).where(eq(deals.id, dealId));
    await reassignWaitAlerts(tx, dealId, userId);
    await logEvent(tx, dealId, "assumiu", { de: deal.ownerId, para: userId, ...(porOferta ? { porOferta: true } : {}) }, userId);
    // As ofertas deste lead (distribuição) se fecham: alguém já assumiu.
    await tx.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.dealId, dealId), like(alerts.waitKey, "oferta:%"), isNull(alerts.resolvedAt)));
    // A dona anterior fica sabendo (a conversa saiu da lista dela).
    if (deal.ownerId) {
      const [[who], [c]] = await Promise.all([
        tx.select({ name: users.name }).from(users).where(eq(users.id, userId)),
        tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).innerJoin(deals, eq(deals.contactId, contacts.id)).where(eq(deals.id, dealId)),
      ]);
      const cliente = clientLabel(c?.name, c?.phone ?? "");
      await tx.insert(alerts).values({ dealId, userId: deal.ownerId, audience: "responsavel", type: "assumiu_sua_conversa", severity: "info",
        message: alertText.claimed(who?.name ?? null, cliente), dedupeKey: `assumiu:${dealId}:${Date.now()}` });
    }
    await tx.insert(auditLog).values({ userId, action: "assumiu", entity: "deal", entityId: dealId, data: { de: deal.ownerId } });
    return deal.ownerId;
  });
  await emit("lead_atualizado", { dealId });
  return { previousOwnerId };
}

/** Fecha as ofertas ("Pode assumir?") abertas da conversa: a dona mudou. */
export async function closeOffers(tx: Tx, dealId: string): Promise<void> {
  await tx.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.dealId, dealId), like(alerts.waitKey, "oferta:%"), isNull(alerts.resolvedAt)));
}

/** Troca a dona dentro de uma transação (usada pelo "Transferir para…" e pelo "Passar para setor"). `actorId` nulo = o sistema. */
export async function transferDealTx(tx: Tx, dealId: string, toUserId: string, actorId: string | null): Promise<void> {
  await updateDealTx(tx, dealId, { ownerId: toUserId }, actorId);
  await closeOffers(tx, dealId);
  if (toUserId === actorId) return;
  const [who, [c]] = await Promise.all([
    actorId ? tx.select({ name: users.name }).from(users).where(eq(users.id, actorId)).then((r) => r[0]) : Promise.resolve({ name: "Sistema" }),
    tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).innerJoin(deals, eq(deals.contactId, contacts.id)).where(eq(deals.id, dealId)),
  ]);
  const cliente = clientLabel(c?.name, c?.phone ?? "");
  await tx.insert(alerts).values({ dealId, userId: toUserId, audience: "responsavel", type: "transferido_para_voce", severity: "info",
    message: alertText.transferred(who?.name ?? null, cliente), dedupeKey: `transferido:${dealId}:${Date.now()}` });
}

/** Quem recebe a conversa precisa estar na equipe e abrir as Conversas (Transferir e a regra "Passar para" pessoa). */
export async function assertTransferTarget(q: Tx | typeof db, toUserId: string): Promise<void> {
  const [target] = await q.select({ id: users.id }).from(users).where(and(eq(users.id, toUserId), eq(users.active, true)));
  if (!target) throw new UserFacingError("Essa pessoa não está mais na equipe.");
  const [canReceive] = await q.select({ id: users.id }).from(users).where(and(eq(users.id, toUserId), canReceiveConversation()));
  if (!canReceive) throw new UserFacingError("Essa pessoa não abre as Conversas: escolha alguém da recepção ou do atendimento.");
}

/** "Transferir para…": troca o responsável (auditado como no Quadro), fecha as ofertas do lead e avisa quem recebe. `actorId` nulo = o sistema (menu). */
export async function transferDeal(dealId: string, toUserId: string, actorId: string | null): Promise<void> {
  await assertTransferTarget(db, toUserId);
  await db.transaction((tx) => transferDealTx(tx, dealId, toUserId, actorId));
  await emit("lead_atualizado", { dealId });
  await emit("alerta", { dealId });
}
