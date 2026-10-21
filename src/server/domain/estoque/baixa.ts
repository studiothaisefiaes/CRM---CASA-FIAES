import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { comandaItems, products, stockMovements } from "../../db/schema";
import { getEstoqueConfig } from "./config";

/**
 * Fechar a comanda baixa o estoque: um movimento 'venda' por item de produto do catálogo, com o custo do produto na hora.
 * Reaproveita o movimento do mesmo item (comanda reaberta e fechada de novo), então nunca duplica. O estoque pode ficar negativo.
 * Com Produtos e estoque desligado, não baixa nada.
 */
export async function saleMovementsTx(tx: Tx, comandaId: string, actorId: string, now: Date): Promise<void> {
  if (!(await getEstoqueConfig(tx)).ligado) return;
  const items = await tx.select({ id: comandaItems.id, productId: comandaItems.productId, qty: comandaItems.qty, costCents: products.costCents })
    .from(comandaItems).innerJoin(products, eq(products.id, comandaItems.productId))
    .where(and(eq(comandaItems.comandaId, comandaId), eq(comandaItems.kind, "produto"), isNull(comandaItems.cancelledAt)));
  const live = items.filter((i) => Number(i.qty) > 0);
  if (!live.length) return;
  await tx.insert(stockMovements).values(live.map((i) => ({
    productId: i.productId!, deltaQty: -Number(i.qty), reason: "venda", comandaItemId: i.id, unitCostCents: i.costCents, createdBy: actorId, createdAt: now, cancelledAt: null,
  }))).onConflictDoUpdate({
    target: stockMovements.comandaItemId, targetWhere: sql`${stockMovements.reason} = 'venda'`,
    set: { productId: sql`excluded.product_id`, deltaQty: sql`excluded.delta_qty`, unitCostCents: sql`excluded.unit_cost_cents`, createdBy: sql`excluded.created_by`, createdAt: sql`excluded.created_at`, cancelledAt: null },
  });
}

/** Estorna a baixa da comanda (reabrir e cancelar). Roda sempre, mesmo com Produtos e estoque desligado. */
export async function reverseSaleMovementsTx(tx: Tx, comandaId: string, now: Date): Promise<void> {
  const ids = (await tx.select({ id: comandaItems.id }).from(comandaItems).where(eq(comandaItems.comandaId, comandaId))).map((x) => x.id);
  if (!ids.length) return;
  await tx.update(stockMovements).set({ cancelledAt: now })
    .where(and(inArray(stockMovements.comandaItemId, ids), eq(stockMovements.reason, "venda"), isNull(stockMovements.cancelledAt)));
}
