import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, products, stockMovements, type Product } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { isCfop, isCsosn } from "@/lib/estoque-settings";
import { assertEstoqueOn } from "./config";

export type ProductInput = {
  id?: string; name: string; brand?: string | null; category?: string | null; barcode?: string | null; ncm?: string | null;
  priceCents: number | null; costCents?: number | null; use?: "venda" | "consumo"; minQty?: number | null; active?: boolean;
  /** Códigos fiscais do produto (M-3). Sem eles: o produto novo nasce com o padrão de Configurações › Estoque e o salvo mantém os seus. */
  cfop?: string | null; csosn?: string | null;
};
export type ProductRow = Product & { stockQty: number; below: boolean; negative: boolean };

const clean = (v: string | null | undefined) => v?.trim() || null;
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Cadastra ou muda um produto (estoque.produtos). Produto novo nasce com CFOP, CSOSN e unidade padrão de Configurações › Estoque (o CFOP e o CSOSN podem vir na tela). */
export async function saveProduct(i: ProductInput, actor: Actor): Promise<{ id: string }> {
  if (!can(actor.perms, "estoque.produtos")) throw new UserFacingError("Você não tem permissão para cadastrar produtos.");
  const name = (i.name ?? "").trim();
  if (!name) throw new UserFacingError("Escreva o nome do produto.");
  if (i.priceCents != null && !isCents(i.priceCents)) throw new UserFacingError("Preço inválido.");
  if (i.costCents != null && !isCents(i.costCents)) throw new UserFacingError("Custo inválido.");
  const ncm = clean(i.ncm);
  if (ncm && !/^[0-9]{8}$/.test(ncm)) throw new UserFacingError("O NCM tem 8 números.");
  if (i.minQty != null && !(Number.isFinite(i.minQty) && i.minQty >= 0)) throw new UserFacingError("O estoque mínimo não pode ser negativo.");
  const cfop = clean(i.cfop), csosn = clean(i.csosn);
  if (cfop && !isCfop(cfop)) throw new UserFacingError("O CFOP tem 4 números.");
  if (csosn && !isCsosn(csosn)) throw new UserFacingError("O CSOSN tem 3 números.");
  const use = i.use ?? "venda";
  if (use !== "venda" && use !== "consumo") throw new UserFacingError("Escolha se o produto é de venda ou de consumo.");
  return db.transaction(async (tx) => {
    const cfg = await assertEstoqueOn(tx);
    const dup = await tx.select({ id: products.id }).from(products).where(and(sql`lower(${products.name}) = lower(${name})`, i.id ? ne(products.id, i.id) : undefined));
    if (dup.length) throw new UserFacingError("Já existe um produto com esse nome.");
    const campos = { name, brand: clean(i.brand), category: clean(i.category), barcode: clean(i.barcode), ncm, priceCents: i.priceCents ?? null, costCents: i.costCents ?? null, use, minQty: i.minQty ?? null };
    if (i.id) {
      const [de] = await tx.select().from(products).where(eq(products.id, i.id));
      if (!de) throw new UserFacingError("Esse produto não existe mais.");
      const para = { ...campos, cfop: cfop ?? de.cfop, csosn: csosn ?? de.csosn, active: i.active ?? de.active };
      await tx.update(products).set({ ...para, updatedAt: new Date() }).where(eq(products.id, i.id));
      const pick = (p: typeof de) => ({ name: p.name, brand: p.brand, category: p.category, barcode: p.barcode, ncm: p.ncm, cfop: p.cfop, csosn: p.csosn, priceCents: p.priceCents, costCents: p.costCents, use: p.use, minQty: p.minQty, active: p.active });
      await tx.insert(auditLog).values({ userId: actor.id, action: "produto_salvo", entity: "products", entityId: i.id, data: { de: pick(de), para } });
      return { id: i.id };
    }
    const fiscal = { cfop: cfop ?? cfg.cfopPadrao, csosn: csosn ?? cfg.csosnPadrao };
    const [row] = await tx.insert(products).values({ ...campos, ...fiscal, unit: cfg.unidadePadrao, active: i.active ?? true, createdBy: actor.id }).returning({ id: products.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "produto_salvo", entity: "products", entityId: row.id, data: { de: null, para: { ...campos, ...fiscal, active: i.active ?? true } } });
    return row;
  });
}

const STOCK = sql<number>`coalesce((select sum(sm.delta_qty) from stock_movements sm where sm.product_id = products.id and sm.cancelled_at is null), 0)::float8`;

/** Catálogo com o estoque de cada um (soma dos movimentos vivos). Não recusa com Produtos e estoque desligado. */
export async function listProducts(f: { q?: string; situacao?: "todos" | "abaixo_minimo" | "negativo"; activeOnly?: boolean } = {}): Promise<ProductRow[]> {
  const q = f.q?.trim();
  const rows = await db.select({ p: products, stockQty: STOCK }).from(products)
    .where(and(f.activeOnly ? eq(products.active, true) : undefined, q ? or(ilike(products.name, `%${q}%`), ilike(products.brand, `%${q}%`), ilike(products.barcode, `%${q}%`)) : undefined))
    .orderBy(asc(sql`lower(${products.name})`));
  const out = rows.map(({ p, stockQty }) => ({ ...p, stockQty, below: p.minQty != null && stockQty < p.minQty, negative: stockQty < 0 }));
  return f.situacao === "abaixo_minimo" ? out.filter((r) => r.below) : f.situacao === "negativo" ? out.filter((r) => r.negative) : out;
}

/** Entrada, saída ou ajuste (estoque.movimentar). No ajuste, `qty` é o estoque contado e o movimento grava a diferença. */
export async function addStockMovement(m: { productId: string; kind: "entrada" | "saida" | "ajuste"; qty: number; unitCostCents?: number | null; note?: string | null }, actor: Actor): Promise<void> {
  if (!can(actor.perms, "estoque.movimentar")) throw new UserFacingError("Você não tem permissão para mexer no estoque.");
  if (!["entrada", "saida", "ajuste"].includes(m.kind)) throw new UserFacingError("Escolha entrada, saída ou ajuste.");
  if (!Number.isFinite(m.qty) || (m.kind === "ajuste" ? m.qty < 0 : m.qty <= 0)) throw new UserFacingError(m.kind === "ajuste" ? "Digite a quantidade contada (pode ser zero)." : "Digite uma quantidade maior que zero.");
  if (m.unitCostCents != null && !isCents(m.unitCostCents)) throw new UserFacingError("Custo inválido.");
  const note = clean(m.note);
  if (m.kind !== "entrada" && !note) throw new UserFacingError(m.kind === "saida" ? "Escreva o motivo da saída." : "Escreva o motivo do ajuste.");
  await db.transaction(async (tx) => {
    await assertEstoqueOn(tx);
    const [p] = await tx.select().from(products).where(eq(products.id, m.productId)).for("update");
    if (!p) throw new UserFacingError("Esse produto não existe mais.");
    const [{ qty: atual }] = await tx.select({ qty: sql<number>`coalesce(sum(${stockMovements.deltaQty}), 0)::float8` }).from(stockMovements)
      .where(and(eq(stockMovements.productId, p.id), sql`${stockMovements.cancelledAt} is null`));
    // Evita resto de ponto flutuante (0,1 + 0,2): estoque em até 3 casas.
    const delta = m.kind === "entrada" ? m.qty : m.kind === "saida" ? -m.qty : Math.round((m.qty - atual) * 1000) / 1000;
    if (delta === 0) return;
    await tx.insert(stockMovements).values({ productId: p.id, deltaQty: delta, reason: m.kind, unitCostCents: m.unitCostCents ?? null, note, createdBy: actor.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "estoque_movimentado", entity: "products", entityId: p.id, data: { produto: p.name, tipo: m.kind, de: atual, para: Math.round((atual + delta) * 1000) / 1000, delta, motivo: note } });
  });
}

export type StockMovementRow = { id: string; deltaQty: number; reason: string; note: string | null; unitCostCents: number | null; createdAt: Date; cancelled: boolean };

/** Últimos movimentos de um produto (os estornados aparecem marcados). Leitura: não depende do liga/desliga. */
export async function listStockMovements(productId: string, limit = 20): Promise<StockMovementRow[]> {
  const rows = await db.select().from(stockMovements).where(eq(stockMovements.productId, productId)).orderBy(sql`${stockMovements.createdAt} desc`, sql`${stockMovements.id} desc`).limit(limit);
  return rows.map((r) => ({ id: r.id, deltaQty: r.deltaQty, reason: r.reason, note: r.note, unitCostCents: r.unitCostCents, createdAt: r.createdAt, cancelled: r.cancelledAt != null }));
}
