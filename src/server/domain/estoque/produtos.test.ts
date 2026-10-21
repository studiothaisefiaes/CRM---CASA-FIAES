import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, products } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import type { Actor } from "../agenda/actor";
import { getEstoqueConfig, saveEstoqueConfig } from "./config";
import { addStockMovement, listProducts, saveProduct } from "./produtos";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const without = (a: Actor, ...p: string[]): Actor => ({ ...a, perms: a.perms.filter((x) => !p.includes(x)) });
beforeEach(async () => { await resetDb(); s = await setupCaixa(); await saveEstoqueConfig({ ligado: true, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }, s.caixaGestao); });

describe("produtos", () => {
  it("ajuste por contagem grava o delta; saída e ajuste pedem motivo; NCM com 8 dígitos", async () => {
    const p = await saveProduct({ name: "Máscara", priceCents: 9000, ncm: "33059000" }, s.caixaGestao);
    await addStockMovement({ productId: p.id, kind: "entrada", qty: 10, unitCostCents: 3000 }, s.caixaGestao);
    await addStockMovement({ productId: p.id, kind: "ajuste", qty: 7.5, note: "contagem" }, s.caixaGestao);
    expect((await listProducts({}))[0].stockQty).toBe(7.5);
    await expect(addStockMovement({ productId: p.id, kind: "saida", qty: 1 }, s.caixaGestao)).rejects.toThrow("Escreva o motivo da saída.");
    await expect(addStockMovement({ productId: p.id, kind: "ajuste", qty: 3 }, s.caixaGestao)).rejects.toThrow("Escreva o motivo do ajuste.");
    await addStockMovement({ productId: p.id, kind: "saida", qty: 0.5, note: "amostra" }, s.caixaGestao);
    expect((await listProducts({}))[0].stockQty).toBe(7);
    await addStockMovement({ productId: p.id, kind: "ajuste", qty: 7, note: "igual" }, s.caixaGestao); // sem diferença: não grava
    await expect(saveProduct({ name: "Ruim", priceCents: 1, ncm: "123" }, s.caixaGestao)).rejects.toThrow("O NCM tem 8 números.");
  });

  it("abaixo do mínimo: estoque < minQty; nome único", async () => {
    const p = await saveProduct({ name: "Óleo", priceCents: 5000, minQty: 3 }, s.caixaGestao);
    await addStockMovement({ productId: p.id, kind: "entrada", qty: 2 }, s.caixaGestao);
    expect((await listProducts({ situacao: "abaixo_minimo" })).map((x) => x.name)).toEqual(["Óleo"]);
    await addStockMovement({ productId: p.id, kind: "entrada", qty: 5 }, s.caixaGestao);
    expect(await listProducts({ situacao: "abaixo_minimo" })).toEqual([]);
    await expect(saveProduct({ name: "óleo", priceCents: 1 }, s.caixaGestao)).rejects.toThrow("Já existe um produto com esse nome.");
  });

  it("sem a permissão, o servidor recusa", async () => {
    await expect(saveProduct({ name: "X", priceCents: 1 }, without(s.caixaGestao, "estoque.produtos"))).rejects.toThrow("Você não tem permissão para cadastrar produtos.");
    const p = await saveProduct({ name: "Y", priceCents: 1 }, s.caixaGestao);
    await expect(addStockMovement({ productId: p.id, kind: "entrada", qty: 1 }, without(s.caixaGestao, "estoque.movimentar"))).rejects.toThrow("Você não tem permissão para mexer no estoque.");
    await expect(saveProduct({ name: "Z", priceCents: 1 }, without(s.caixaGestao, "servicos.editar"))).resolves.toBeTruthy(); // não pede servicos.editar
  });

  it("CFOP e CSOSN do produto (M-3): editáveis com estoque.produtos, validados (4 e 3 números), padrão da config quando não vêm, auditados", async () => {
    const p = await saveProduct({ name: "Gel", priceCents: 100, cfop: "5405", csosn: "500" }, s.caixaGestao);
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0]).toMatchObject({ cfop: "5405", csosn: "500" });
    const q = await saveProduct({ name: "Pomada", priceCents: 100 }, s.caixaGestao);
    expect((await db.select().from(products).where(eq(products.id, q.id)))[0]).toMatchObject({ cfop: "5102", csosn: "102" });
    await saveProduct({ id: q.id, name: "Pomada", priceCents: 100, cfop: "5405" }, s.caixaGestao); // CSOSN não veio: fica o que era
    expect((await db.select().from(products).where(eq(products.id, q.id)))[0]).toMatchObject({ cfop: "5405", csosn: "102" });
    const [a] = (await db.select().from(auditLog).where(eq(auditLog.action, "produto_salvo"))).filter((x) => x.entityId === q.id && (x.data as { de: unknown }).de);
    expect(a.data).toMatchObject({ de: { cfop: "5102", csosn: "102" }, para: { cfop: "5405", csosn: "102" } });
    await expect(saveProduct({ name: "Ruim", priceCents: 1, cfop: "51" }, s.caixaGestao)).rejects.toThrow("O CFOP tem 4 números.");
    await expect(saveProduct({ name: "Ruim", priceCents: 1, csosn: "1020" }, s.caixaGestao)).rejects.toThrow("O CSOSN tem 3 números.");
    await expect(saveProduct({ id: q.id, name: "Pomada", priceCents: 100, cfop: "5102" }, without(s.caixaGestao, "estoque.produtos"))).rejects.toThrow("Você não tem permissão para cadastrar produtos.");
  });

  it("os padrões da configuração valem ao criar; salvar auditado; config valida", async () => {
    await saveEstoqueConfig({ ligado: true, cfopPadrao: "5405", csosnPadrao: "500", unidadePadrao: "ml" }, s.caixaGestao);
    expect(await getEstoqueConfig()).toEqual({ ligado: true, cfopPadrao: "5405", csosnPadrao: "500", unidadePadrao: "ML" });
    const p = await saveProduct({ name: "Tônico", priceCents: 100 }, s.caixaGestao);
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0]).toMatchObject({ cfop: "5405", csosn: "500", unit: "ML" });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "estoque_configurado"))).length).toBe(2);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "produto_salvo"))).length).toBe(1);
    await expect(saveEstoqueConfig({ ligado: true, cfopPadrao: "51", csosnPadrao: "500", unidadePadrao: "UN" }, s.caixaGestao)).rejects.toThrow("O CFOP padrão tem 4 números.");
    await expect(saveEstoqueConfig({ ligado: true, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }, without(s.caixaGestao, "config.sistema"))).rejects.toThrow("Você não tem permissão para configurar o Estoque.");
  });
});
