import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { comandaItems, stockMovements } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { randomUUID } from "node:crypto";
import { addItem, addPayment, cancelComanda, closeComanda, openWalkInComanda, PRICE_REASON, reopenComanda, reopenForCorrection, updateItem } from "../caixa/comandas";
import { openCash } from "../caixa/cash";
import { saveEstoqueConfig } from "./config";
import { addStockMovement, listProducts, saveProduct } from "./produtos";

let s: Awaited<ReturnType<typeof setupCaixa>>;
let shampoo: { id: string };
let c: { comandaId: string };
const ESCOLHA = "Escolha o produto (cadastre em Serviços e pacotes › Produtos).";
const estoque = async () => (await listProducts({})).map((p) => [p.name, p.stockQty]);
const vendas = (itemId?: string) => db.select().from(stockMovements).where(and(eq(stockMovements.reason, "venda"), itemId ? eq(stockMovements.comandaItemId, itemId) : undefined));
const vivos = async () => (await vendas()).filter((m) => !m.cancelledAt);

async function fechar2(now = NOW) {
  const { id } = await addItem(c.comandaId, { kind: "produto", productId: shampoo.id, qty: 2 }, s.caixaRecepcao, now);
  await addPayment(c.comandaId, { method: "pix", valueCents: 8000 }, s.caixaRecepcao, now);
  await closeComanda(c.comandaId, {}, s.caixaRecepcao, now);
  return id;
}

beforeEach(async () => {
  await resetDb();
  s = await setupCaixa();
  await saveEstoqueConfig({ ligado: true, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }, s.caixaGestao);
  shampoo = await saveProduct({ name: "Shampoo Fiaes", priceCents: 4000, costCents: 1800 }, s.caixaGestao);
  await addStockMovement({ productId: shampoo.id, kind: "entrada", qty: 1 }, s.caixaGestao);
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  c = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Moça" }, s.caixaRecepcao, NOW);
});

describe("baixa pela comanda", () => {
  it("fechar a comanda com 2 frascos baixa 2 e o estoque fica −1, sem travar o caixa", async () => {
    await fechar2();
    expect((await listProducts({ situacao: "negativo" })).map((p) => [p.name, p.stockQty])).toEqual([["Shampoo Fiaes", -1]]);
    expect((await vivos())[0]).toMatchObject({ deltaQty: -2, unitCostCents: 1800 });
  });

  it("reabrir estorna; fechar de novo baixa de novo sem duplicar", async () => {
    const itemId = await fechar2();
    expect(await estoque()).toEqual([["Shampoo Fiaes", -1]]);
    await reopenComanda(c.comandaId, { reason: "erro" }, s.caixaRecepcao, NOW);
    expect(await estoque()).toEqual([["Shampoo Fiaes", 1]]);
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW);
    expect(await estoque()).toEqual([["Shampoo Fiaes", -1]]);
    expect(await vendas(itemId)).toHaveLength(1);
    expect((await vivos())).toHaveLength(1);
  });

  it("cancelar a comanda fechada estorna", async () => {
    await fechar2();
    await cancelComanda(c.comandaId, { reason: "erro" }, s.caixaGestao, NOW);
    expect(await estoque()).toEqual([["Shampoo Fiaes", 1]]);
  });

  it("reabrir para corrigir estorna", async () => {
    await fechar2();
    await reopenForCorrection(c.comandaId, { reason: "erro" }, s.caixaGestao, NOW);
    expect(await estoque()).toEqual([["Shampoo Fiaes", 1]]);
  });

  it("produto sem catálogo não entra", async () => {
    await expect(addItem(c.comandaId, { kind: "produto", label: "Shampoo" }, s.caixaRecepcao)).rejects.toThrow(ESCOLHA);
  });

  it("preço diferente do catálogo pede motivo, como no serviço", async () => {
    await expect(addItem(c.comandaId, { kind: "produto", productId: shampoo.id, unitCents: 3500 }, s.caixaRecepcao)).rejects.toThrow(PRICE_REASON);
  });

  it("item de produto grava fiscal_kind 'produto', product_id e label = nome do produto", async () => {
    const { id } = await addItem(c.comandaId, { kind: "produto", productId: shampoo.id, label: "outro nome" }, s.caixaRecepcao);
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.id, id));
    expect(it).toMatchObject({ fiscalKind: "produto", label: "Shampoo Fiaes", productId: shampoo.id, unitCents: 4000 });
  });

  it("editar quantidade e preço de item de produto já lançado funciona com o estoque ligado", async () => {
    const { id } = await addItem(c.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao);
    await updateItem(id, { qty: 3 }, s.caixaRecepcao);
    await updateItem(id, { unitCents: 3500, reason: "promoção" }, s.caixaRecepcao);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.id, id)))[0]).toMatchObject({ qty: 3, unitCents: 3500, productId: shampoo.id, label: "Shampoo Fiaes", originalUnitCents: 4000 });
  });

  it("produto desativado depois do lançamento: o item continua editável, mas a escolha nova exige ativo", async () => {
    const { id } = await addItem(c.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao);
    await saveProduct({ id: shampoo.id, name: "Shampoo Fiaes", priceCents: 4000, active: false }, s.caixaGestao);
    await updateItem(id, { qty: 2 }, s.caixaRecepcao);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.id, id)))[0]).toMatchObject({ qty: 2, productId: shampoo.id });
    await expect(addItem(c.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao)).rejects.toThrow(ESCOLHA);
  });

  it("produto desativado não entra na comanda", async () => {
    await saveProduct({ id: shampoo.id, name: "Shampoo Fiaes", priceCents: 4000, active: false }, s.caixaGestao);
    await expect(addItem(c.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao)).rejects.toThrow(ESCOLHA);
  });
});

describe("Produtos e estoque desligado", () => {
  it("volta ao texto livre, sem baixa; escritas de produto e estoque são recusadas; o estorno roda sempre", async () => {
    const itemId = await fechar2(); // ligado: baixou
    await reopenComanda(c.comandaId, { reason: "erro" }, s.caixaRecepcao, NOW);
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW); // baixa de novo
    await reopenComanda(c.comandaId, { reason: "erro" }, s.caixaRecepcao, NOW);
    await saveEstoqueConfig({ ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }, s.caixaGestao);
    expect(await estoque()).toEqual([["Shampoo Fiaes", 1]]); // estorno rodou antes; a lista não recusa
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW); // desligado: não baixa
    expect(await estoque()).toEqual([["Shampoo Fiaes", 1]]);
    await reopenComanda(c.comandaId, { reason: "erro" }, s.caixaRecepcao, NOW);
    expect(await vendas(itemId)).toHaveLength(1);
    const off = "Produtos e estoque está desligado em Configurações › Estoque.";
    await expect(saveProduct({ name: "Outro", priceCents: 1 }, s.caixaGestao)).rejects.toThrow(off);
    await expect(addStockMovement({ productId: shampoo.id, kind: "entrada", qty: 1 }, s.caixaGestao)).rejects.toThrow(off);
    const { id } = await addItem(c.comandaId, { kind: "produto", label: "Kit", unitCents: 500 }, s.caixaRecepcao);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.id, id)))[0]).toMatchObject({ label: "Kit", productId: null });
    await expect(addItem(c.comandaId, { kind: "produto", label: " " }, s.caixaRecepcao)).rejects.toThrow("Escreva o nome do produto.");
    expect(await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, c.comandaId), isNull(comandaItems.cancelledAt)))).toHaveLength(2);
  });
});
