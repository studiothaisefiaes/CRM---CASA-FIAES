import { and, eq, sql } from "drizzle-orm";
import { auditLog, products, stockMovements } from "../../db/schema";
import { getCaixaMode } from "../caixa/mode";
import { getEstoqueConfig } from "../estoque/config";
import { STOCK_COLS } from "./formats";
import { clean, moneyCents, normText } from "./normalize";
import type { ImportCtx } from "./context";

/**
 * Posição de Estoque (0149): cria os produtos que faltam e completa só o que está vazio no CRM (o que a Casa mudou não volta).
 * Liga pelo `avecName` normalizado e, sem ele, pelo nome. O saldo só segue o Avec no modo de caixa "avec": grava um movimento
 * `saldo_avec` com a diferença entre a quantidade do Avec e o estoque de agora. No modo "crm" o estoque nunca é tocado.
 * Com Produtos e estoque desligado em Configurações › Estoque, o papel é pulado e o resumo conta as linhas ignoradas.
 */
export async function importProducts(ctx: ImportCtx): Promise<{ criados: number; atualizados: number; saldos: number }> {
  const out = { criados: 0, atualizados: 0, saldos: 0 };
  const cfg = await getEstoqueConfig(ctx.tx);
  const ix = { name: ctx.col("produto"), cat: ctx.col("categoria"), brand: ctx.col("marca"), cost: ctx.col("custo"), price: ctx.col("valor"), ncm: ctx.col("ncm"), barcode: ctx.col("cod. barras", "cod barras", "codigo de barras"), qty: ctx.col(...STOCK_COLS) };
  const lines = ctx.rows.filter((r) => clean(ctx.cell(r, ix.name)));
  if (!cfg.ligado) { ctx.summary.produtosIgnorados += lines.length; return out; }
  const follow = (await getCaixaMode(ctx.tx)) === "avec";

  const all = await ctx.tx.select().from(products);
  const byAvec = new Map<string, (typeof all)[number]>(), byName = new Map<string, (typeof all)[number]>();
  const index = (p: (typeof all)[number]) => { if (p.avecName) byAvec.set(normText(p.avecName), p); byName.set(normText(p.name), p); };
  all.forEach(index);

  for (const row of lines) {
    const name = clean(ctx.cell(row, ix.name))!, key = normText(name);
    const brand = clean(ctx.cell(row, ix.brand)), category = clean(ctx.cell(row, ix.cat)), barcode = clean(ctx.cell(row, ix.barcode));
    const ncmRaw = ctx.cell(row, ix.ncm).replace(/\D/g, ""), ncm = /^[0-9]{8}$/.test(ncmRaw) ? ncmRaw : null;
    const price = moneyCents(ctx.cell(row, ix.price)), cost = moneyCents(ctx.cell(row, ix.cost));
    let p = byAvec.get(key) ?? byName.get(key);
    if (!p) {
      [p] = await ctx.tx.insert(products).values({
        name, avecName: name, brand, category, barcode, ncm, priceCents: price != null && price >= 0 ? price : null, costCents: cost != null && cost >= 0 ? cost : null,
        cfop: cfg.cfopPadrao, csosn: cfg.csosnPadrao, unit: cfg.unidadePadrao, createdBy: ctx.userId,
      }).returning();
      index(p);
      out.criados++;
    } else {
      const patch: Partial<typeof products.$inferInsert> = {};
      if (!p.avecName) patch.avecName = name;
      if (!p.brand && brand) patch.brand = brand;
      if (!p.category && category) patch.category = category;
      if (!p.barcode && barcode) patch.barcode = barcode;
      if (!p.ncm && ncm) patch.ncm = ncm;
      if (p.priceCents == null && price != null && price >= 0) patch.priceCents = price;
      if (p.costCents == null && cost != null && cost >= 0) patch.costCents = cost;
      if (Object.keys(patch).length) {
        [p] = await ctx.tx.update(products).set({ ...patch, updatedAt: new Date() }).where(eq(products.id, p.id)).returning();
        index(p);
        // Só conta como "atualizado" quando algo além da ligação com o nome do Avec mudou.
        if (Object.keys(patch).some((k) => k !== "avecName")) out.atualizados++;
      }
    }
    if (!follow) continue;
    const avecQty = parseQty(ctx.cell(row, ix.qty));
    if (avecQty == null) continue;
    const [{ qty: atual }] = await ctx.tx.select({ qty: sql<number>`coalesce(sum(${stockMovements.deltaQty}), 0)::float8` }).from(stockMovements)
      .where(and(eq(stockMovements.productId, p.id), sql`${stockMovements.cancelledAt} is null`));
    const delta = Math.round((avecQty - atual) * 1000) / 1000;
    if (delta === 0) continue;
    await ctx.tx.insert(stockMovements).values({ productId: p.id, deltaQty: delta, reason: "saldo_avec", note: "Saldo do relatório Posição de Estoque do Avec", createdBy: ctx.userId });
    out.saldos++;
  }
  ctx.summary.produtos += out.criados + out.atualizados;
  ctx.summary.saldosEstoque += out.saldos;
  if (out.criados || out.atualizados || out.saldos) {
    await ctx.tx.insert(auditLog).values({ userId: ctx.userId, action: "avec_produtos_importados", entity: "products", entityId: ctx.signature ?? "avec", data: { ...out, saldoSegueAvec: follow } });
  }
  return out;
}

/** "5", "1,5", "1.234,5", "-2": quantidade com até 3 casas; vazio ou ilegível volta null (não mexe no saldo). */
function parseQty(v: string): number | null {
  let s = v.replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 1000) / 1000;
  return Number.isFinite(n) ? n : null;
}
