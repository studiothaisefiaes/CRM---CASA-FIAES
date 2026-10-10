import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, deals } from "../db/schema";
import { emit, logEvent } from "./events";

/** "Assumir": a pessoa logada passa a ser a responsável pelo lead. Quem responde pelo celular conectado conta como ela. */
export async function claimDeal(dealId: string, userId: string): Promise<{ previousOwnerId: string | null }> {
  const previousOwnerId = await db.transaction(async (tx) => {
    const [deal] = await tx.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, dealId)).for("update");
    if (!deal) throw new Error("Lead não encontrado");
    if (deal.ownerId === userId) return deal.ownerId;
    await tx.update(deals).set({ ownerId: userId }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "assumiu", { de: deal.ownerId, para: userId }, userId);
    await tx.insert(auditLog).values({ userId, action: "assumiu", entity: "deal", entityId: dealId, data: { de: deal.ownerId } });
    return deal.ownerId;
  });
  await emit("lead_atualizado", { dealId });
  return { previousOwnerId };
}
