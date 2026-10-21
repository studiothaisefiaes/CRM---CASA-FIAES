import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, products, settings, stockMovements } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { importa } from "../../../../test/avec-fixtures";
import { getEstoqueConfig } from "../estoque/config";

const H = ["Produto", "Categoria", "Custo", "Valor", "Custo Médio Ponderado", "Medida", "Qtd. Estoque", "Qtd. Estoque Absoluto", "Marca", "Linha", "NCM", "Cód. Barras", "Cód. Interno", "Local de estoque", "Custo Total", "Preço Venda Total"];
const linha = (nome: string, o: { cat?: string; custo?: string; valor?: string; qtd?: string; marca?: string; ncm?: string; barras?: string } = {}) =>
  [nome, o.cat ?? "Cabelos", o.custo ?? "20,00", o.valor ?? "45,90", "", "UN", o.qtd ?? "5", "", o.marca ?? "Kerastase", "", o.ncm ?? "33059000", o.barras ?? "789000", "", "Salão", "", ""];
const setKey = (key: string, value: unknown) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
const prods = () => db.select().from(products).orderBy(products.name);
const movs = () => db.select().from(stockMovements).orderBy(stockMovements.createdAt);
const stock = async () => (await movs()).filter((m) => !m.cancelledAt).reduce((s, m) => s + m.deltaQty, 0);

beforeEach(async () => { await resetDb(); await setKey("caixa_modo", "avec"); });

describe("importar produtos do Avec (0149)", () => {
  it("cria 2 produtos com padrões da configuração e o saldo; reimportar com outro saldo grava o delta", async () => {
    await setKey("estoque_config", { ligado: true, cfopPadrao: "5405", csosnPadrao: "500", unidadePadrao: "ML" });
    const r = await importa("p.xlsx", H, [linha("Shampoo Nutritive"), linha("Máscara Gold", { qtd: "3", valor: "120,00" })]);
    expect(r.summary).toMatchObject({ produtos: 2, saldosEstoque: 2 });
    const rows = await prods();
    expect(rows.map((p) => [p.name, p.priceCents, p.costCents, p.ncm, p.barcode, p.brand, p.category, p.avecName, p.cfop, p.csosn, p.unit])).toEqual([
      ["Máscara Gold", 12000, 2000, "33059000", "789000", "Kerastase", "Cabelos", "Máscara Gold", "5405", "500", "ML"],
      ["Shampoo Nutritive", 4590, 2000, "33059000", "789000", "Kerastase", "Cabelos", "Shampoo Nutritive", "5405", "500", "ML"]]);
    expect(await stock()).toBe(8);
    const again = await importa("p2.xlsx", H, [linha("Shampoo Nutritive", { qtd: "2" }), linha("Máscara Gold", { qtd: "3", valor: "120,00" })]);
    expect(again.summary).toMatchObject({ produtos: 0, saldosEstoque: 1 });
    const mv = (await movs()).filter((m) => m.reason === "saldo_avec").map((m) => m.deltaQty);
    expect([...mv].sort((a, b) => a - b)).toEqual([-3, 3, 5]);
    expect(await stock()).toBe(5);
    expect((await importa("p3.xlsx", H, [linha("Shampoo Nutritive", { qtd: "2" })])).summary.saldosEstoque).toBe(0);
  });

  it("o preço mudado no CRM não volta; campo vazio é preenchido; liga pelo avecName ou pelo nome", async () => {
    await db.insert(products).values([{ name: "shampoo nutritive", priceCents: 9900 }, { name: "Nome do CRM", avecName: "Máscara Gold", brand: "Minha" }]);
    const r = await importa("p.xlsx", H, [linha("Shampoo Nutritive"), linha("Máscara Gold")]);
    expect(r.summary.produtos).toBe(2);
    const rows = await prods();
    expect(rows).toHaveLength(2);
    const sh = rows.find((p) => p.name === "shampoo nutritive")!, mk = rows.find((p) => p.name === "Nome do CRM")!;
    expect([sh.priceCents, sh.costCents, sh.avecName]).toEqual([9900, 2000, "Shampoo Nutritive"]);
    expect([mk.brand, mk.priceCents]).toEqual(["Minha", 4590]);
  });

  it("modo crm: cria/completa o cadastro mas nunca mexe no estoque", async () => {
    await setKey("caixa_modo", "crm");
    const r = await importa("p.xlsx", H, [linha("Shampoo Nutritive")]);
    expect(r.summary).toMatchObject({ produtos: 1, saldosEstoque: 0 });
    expect(await movs()).toEqual([]);
  });

  it("estoque desligado: não cria, não atualiza e não grava saldo; o resumo diz que foi ignorado", async () => {
    await db.insert(products).values({ name: "Shampoo Nutritive" });
    await setKey("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" });
    expect((await getEstoqueConfig()).ligado).toBe(false);
    const r = await importa("p.xlsx", H, [linha("Shampoo Nutritive"), linha("Máscara Gold")]);
    expect(r.summary).toMatchObject({ produtos: 0, saldosEstoque: 0, produtosIgnorados: 2 });
    const rows = await prods();
    expect(rows.map((p) => [p.name, p.priceCents, p.avecName])).toEqual([["Shampoo Nutritive", null, null]]);
    expect(await movs()).toEqual([]);
    const { summaryLines } = await import("@/components/relatorios-avec/format");
    expect(summaryLines(r.summary).map((l) => l.label).join(" ")).toContain("Produtos e estoque está desligado em Configurações › Estoque.");
  });

  it("grava quem importou no movimento e uma auditoria", async () => {
    const { setupCaixa } = await import("../../../../test/caixa-fixtures");
    const u = (await setupCaixa()).gestora;
    await setKey("caixa_modo", "avec");
    const { applyAvecFile } = await import("./apply");
    const { avecSheet } = await import("../../../../test/avec-fixtures");
    await applyAvecFile({ ...(await avecSheet("p.xlsx", [H, linha("Shampoo Nutritive")])), userId: u.id });
    expect((await movs())[0]).toMatchObject({ reason: "saldo_avec", deltaQty: 5, createdBy: u.id });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "avec_produtos_importados"))).length).toBe(1);
  });
});
