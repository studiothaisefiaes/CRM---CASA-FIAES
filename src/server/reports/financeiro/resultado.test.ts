import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { products, stockMovements } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { item as avecItem, payment } from "../../../../test/salon-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { salonRange } from "@/lib/salon-period";
import type { DreKey } from "@/lib/dre";
import { UserFacingError } from "../../domain/errors";
import { cancelExpense, createExpense, payExpense } from "../../domain/financeiro/despesas";
import { saveBankAccount, saveCategory, saveMethodAccounts } from "../../domain/financeiro/cadastros";
import { assertCanSeeResultado, loadResultado } from "./resultado";

const NOW = new Date("2026-10-18T12:00:00Z");
let s: Awaited<ReturnType<typeof setupCaixa>>;
let aluguel: { id: string }, mkt: { id: string };
const OUT = () => salonRange({ de: "2026-10-01", ate: "2026-10-31" }, NOW);
beforeEach(async () => {
  await resetDb();
  s = await setupCaixa();
  aluguel = await saveCategory({ name: "Aluguel", dreGroup: "ocupacao" }, s.caixaGestao);
  mkt = await saveCategory({ name: "Anúncios", dreGroup: "marketing" }, s.caixaGestao);
});
const line = (v: Awaited<ReturnType<typeof loadResultado>>, k: DreKey) => v.dre.find((l) => l.key === k)!;
const saidas = (v: Awaited<ReturnType<typeof loadResultado>>) => v.fluxo.reduce((a, r) => a + r.saidasCents, 0);

describe("Resultado: DRE", () => {
  it("CRM e Avec em colunas, nunca somados; a despesa aparece igual nas duas", async () => {
    await comanda({ day: "2026-10-10", by: s.cati.id, items: [{ label: "Corte", unitCents: 10000, netCents: 10000, commissionCents: 4000 }], pays: [{ method: "pix", valueCents: 10000 }] });
    await avecItem({ day: "2026-10-10", value: 8000, commissionCents: 3000 });
    await payment({ day: "2026-10-10", value: 8000 });
    const { ids } = await createExpense({ title: "Aluguel", categoryId: aluguel.id, amountCents: 5000, dueOn: "2026-10-05" }, s.caixaGestao);
    await payExpense(ids[0], { paidOn: "2026-10-05", paidCents: 5000, bankAccountId: null, method: "pix" }, s.caixaGestao);
    const v = await loadResultado(OUT(), NOW);
    expect(v.dre.map((l) => l.key)).toEqual(["receita_servicos", "receita_produtos", "receita_pacotes", "repasse_profissionais", "taxas_cartao", "custo_produtos",
      "pessoal", "ocupacao", "operacao", "marketing", "impostos", "financeiras", "outras"]);
    expect([line(v, "receita_servicos").crmCents, line(v, "receita_servicos").avecCents]).toEqual([10000, 8000]);
    expect([line(v, "repasse_profissionais").crmCents, line(v, "repasse_profissionais").avecCents]).toEqual([4000, 3000]);
    expect([line(v, "ocupacao").crmCents, line(v, "ocupacao").avecCents]).toEqual([5000, 5000]);
    expect([line(v, "taxas_cartao").crmCents, line(v, "taxas_cartao").avecCents]).toEqual([null, null]);
    expect(line(v, "custo_produtos").avecCents).toBeNull();
    expect(v.resultado).toEqual({ crmCents: 10000 - 4000 - 5000, avecCents: 8000 - 3000 - 5000 });
  });

  it("período com recebimento no Avec e no CRM: cada lado só soma o seu, a despesa entra uma vez por coluna", async () => {
    await comanda({ day: "2026-10-12", by: s.cati.id, items: [{ label: "Escova", unitCents: 6000, netCents: 6000 }], pays: [{ method: "pix", valueCents: 6000 }] });
    await avecItem({ day: "2026-10-03", value: 9000 });
    await payment({ day: "2026-10-03", value: 9000 });
    await createExpense({ title: "Anúncio", categoryId: mkt.id, amountCents: 1000, dueOn: "2026-10-20" }, s.caixaGestao);
    const v = await loadResultado(OUT(), NOW);
    expect([line(v, "receita_servicos").crmCents, line(v, "receita_servicos").avecCents]).toEqual([6000, 9000]);
    expect([line(v, "marketing").crmCents, line(v, "marketing").avecCents]).toEqual([1000, 1000]);
    expect(v.resultado).toEqual({ crmCents: 5000, avecCents: 8000 });
    expect(v.fluxo.reduce((a, r) => a + r.entradasCrmCents, 0)).toBe(6000);
    expect(v.fluxo.reduce((a, r) => a + r.entradasAvecCents, 0)).toBe(9000);
  });

  it("receita por tipo: produto e pacote vendido contam, sessão de pacote vale 0, item cancelado e comanda de outro mês ficam fora", async () => {
    await comanda({ day: "2026-10-10", by: s.cati.id, items: [
      { label: "Shampoo", kind: "produto", unitCents: 3000, netCents: 3000 }, { label: "Pacote 5", kind: "pacote_venda", unitCents: 20000, netCents: 20000 },
      { label: "Sessão", kind: "pacote_sessao", unitCents: 0, netCents: 0 }, { label: "Cancelado", unitCents: 999, netCents: 999, cancelled: true }] });
    await comanda({ day: "2026-09-30", by: s.cati.id, items: [{ label: "Corte", unitCents: 7000, netCents: 7000 }] });
    await avecItem({ day: "2026-10-10", value: 4000, kind: "produto" });
    await avecItem({ day: "2026-10-10", value: 5000, kind: "servico", fromPackage: true });
    const v = await loadResultado(OUT(), NOW);
    expect([line(v, "receita_produtos").crmCents, line(v, "receita_produtos").avecCents]).toEqual([3000, 4000]);
    expect([line(v, "receita_pacotes").crmCents, line(v, "receita_pacotes").avecCents]).toEqual([20000, 0]);
    expect([line(v, "receita_servicos").crmCents, line(v, "receita_servicos").avecCents]).toEqual([0, 0]);
  });

  it("net_cents nulo (comanda fechada antes da Task 9) usa o valor que o relatório de itens já usa: total − rateio do desconto", async () => {
    await comanda({ day: "2026-10-10", by: s.cati.id, discountCents: 1000, items: [{ label: "Corte", unitCents: 10000 }, { label: "Barba", unitCents: 10000, netCents: 9500 }] });
    const v = await loadResultado(OUT(), NOW);
    // Corte sem net_cents: 10000 − metade do desconto da comanda (500) = 9500; Barba usa o net_cents gravado.
    expect(line(v, "receita_servicos").crmCents).toBe(9500 + 9500);
  });

  it("custo dos produtos: movimento de venda vivo de comanda fechada no período; estornado, de outro mês e entrada ficam fora", async () => {
    const [p] = await db.insert(products).values({ name: "Shampoo" }).returning();
    const c = await comanda({ day: "2026-10-10", by: s.cati.id, items: [
      { label: "Shampoo", kind: "produto", unitCents: 3000, netCents: 6000, qty: 2, productId: p.id }, { label: "Shampoo", kind: "produto", unitCents: 3000, netCents: 3000, productId: p.id }] });
    const old = await comanda({ day: "2026-09-10", by: s.cati.id, items: [{ label: "Shampoo", kind: "produto", unitCents: 3000, netCents: 3000, productId: p.id }] });
    await db.insert(stockMovements).values([
      { productId: p.id, deltaQty: -2, reason: "venda", comandaItemId: c.items[0].id, unitCostCents: 1000 },
      { productId: p.id, deltaQty: -1, reason: "venda", comandaItemId: c.items[1].id, unitCostCents: 1000, cancelledAt: new Date() },
      { productId: p.id, deltaQty: -1, reason: "venda", comandaItemId: old.items[0].id, unitCostCents: 1000 },
      { productId: p.id, deltaQty: 5, reason: "entrada", unitCostCents: 1000 },
    ]);
    const v = await loadResultado(OUT(), NOW);
    expect(line(v, "custo_produtos").crmCents).toBe(2000);
    expect(v.resultado.crmCents).toBe(6000 + 3000 - 2000);
  });
});

describe("Resultado: meses inteiros (M-2)", () => {
  const AVISO = "O resultado usa meses inteiros: escolha um mês para comparar receita e despesas.";
  it("período que não é mês cheio: o DRE soma a receita dos meses inteiros que ele toca (como as despesas) e avisa; o fluxo fica no período", async () => {
    await comanda({ day: "2026-10-05", by: s.cati.id, items: [{ label: "Corte", unitCents: 10000, netCents: 10000, commissionCents: 4000 }], pays: [{ method: "pix", valueCents: 10000 }] });
    await comanda({ day: "2026-10-12", by: s.cati.id, items: [{ label: "Escova", unitCents: 6000, netCents: 6000 }], pays: [{ method: "pix", valueCents: 6000 }] });
    await comanda({ day: "2026-09-30", by: s.cati.id, items: [{ label: "Corte", unitCents: 9000, netCents: 9000 }] });
    await createExpense({ title: "Aluguel", categoryId: aluguel.id, amountCents: 5000, dueOn: "2026-10-05" }, s.caixaGestao);
    const v = await loadResultado(salonRange({ de: "2026-10-10", ate: "2026-10-15" }, NOW), NOW);
    expect(v.avisoMeses).toBe(AVISO);
    expect(line(v, "receita_servicos").crmCents).toBe(16000); // outubro inteiro, sem setembro
    expect(line(v, "repasse_profissionais").crmCents).toBe(4000);
    expect(line(v, "ocupacao").crmCents).toBe(5000);
    expect(v.resultado.crmCents).toBe(16000 - 4000 - 5000);
    expect(v.fluxo.reduce((a, r) => a + r.entradasCrmCents, 0)).toBe(6000); // o fluxo continua só no período
  });
  it("mês cheio, este mês até hoje e o ano até hoje: sem aviso", async () => {
    expect((await loadResultado(OUT(), NOW)).avisoMeses).toBeUndefined();
    expect((await loadResultado(salonRange({ periodo: "mes" }, NOW), NOW)).avisoMeses).toBeUndefined();
    expect((await loadResultado(salonRange({ periodo: "ano" }, NOW), NOW)).avisoMeses).toBeUndefined();
    expect((await loadResultado(salonRange({ periodo: "7d" }, NOW), NOW)).avisoMeses).toBe(AVISO);
  });
});

describe("Resultado: fluxo e contas", () => {
  it("despesa de competência outubro paga em novembro: DRE de outubro, fluxo de novembro", async () => {
    const { ids } = await createExpense({ title: "Luz", categoryId: aluguel.id, amountCents: 3000, dueOn: "2026-10-25" }, s.caixaGestao);
    await payExpense(ids[0], { paidOn: "2026-11-03", paidCents: 3000, bankAccountId: null, method: "pix" }, s.caixaGestao);
    const out = await loadResultado(OUT(), NOW);
    const nov = await loadResultado(salonRange({ de: "2026-11-01", ate: "2026-11-30" }, NOW), NOW);
    expect(line(out, "ocupacao").crmCents).toBe(3000);
    expect(saidas(out)).toBe(0);
    expect(line(nov, "ocupacao").crmCents).toBe(0);
    expect(saidas(nov)).toBe(3000);
  });

  it("fluxo: a pagar pelo vencimento, pagas pela data do pagamento, canceladas fora; por mês quando o período é grande", async () => {
    const a = await createExpense({ title: "A", categoryId: aluguel.id, amountCents: 1000, dueOn: "2026-10-12" }, s.caixaGestao);
    await createExpense({ title: "B", categoryId: aluguel.id, amountCents: 2000, dueOn: "2026-10-20" }, s.caixaGestao);
    const c = await createExpense({ title: "C", categoryId: aluguel.id, amountCents: 4000, dueOn: "2026-10-12" }, s.caixaGestao);
    await payExpense(a.ids[0], { paidOn: "2026-10-13", paidCents: 900, bankAccountId: null, method: "pix" }, s.caixaGestao);
    await cancelExpense(c.ids[0], { reason: "engano", scope: "esta" }, s.caixaGestao);
    const v = await loadResultado(OUT(), NOW);
    const at = (k: string) => v.fluxo.find((r) => r.key === k)!;
    expect(v.fluxo).toHaveLength(31);
    expect(at("2026-10-13")).toMatchObject({ saidasCents: 900, aPagarCents: 0 });
    expect(at("2026-10-20")).toMatchObject({ saidasCents: 0, aPagarCents: 2000 });
    expect(at("2026-10-12")).toMatchObject({ saidasCents: 0, aPagarCents: 0 });
    const ano = await loadResultado(salonRange({ de: "2026-01-01", ate: "2026-12-31" }, NOW), NOW);
    expect(ano.fluxo.find((r) => r.key === "2026-10")).toMatchObject({ saidasCents: 900, aPagarCents: 2000 });
  });

  it("saldo por conta: abertura + PIX ligado à conta − despesa paga por ela; dinheiro sem conta e Avec não entram", async () => {
    const banco = await saveBankAccount({ name: "Itaú", openingCents: 10000 }, s.caixaGestao);
    await saveBankAccount({ name: "Cofre", openingCents: 500 }, s.caixaGestao);
    await saveMethodAccounts({ pix: banco.id }, s.caixaGestao);
    await comanda({ day: "2026-09-20", by: s.cati.id, pays: [{ method: "pix", valueCents: 7000 }, { method: "dinheiro", valueCents: 999 }] });
    await comanda({ day: "2026-10-11", by: s.cati.id, pays: [{ method: "pix", valueCents: 3000 }] });
    await comanda({ day: "2026-11-11", by: s.cati.id, pays: [{ method: "pix", valueCents: 50000 }] }); // depois do fim do período
    await payment({ day: "2026-10-11", value: 123456, method: "Pix" });
    const { ids } = await createExpense({ title: "Aluguel", categoryId: aluguel.id, amountCents: 4000, dueOn: "2026-10-05" }, s.caixaGestao);
    await payExpense(ids[0], { paidOn: "2026-10-05", paidCents: 4000, bankAccountId: banco.id, method: "pix" }, s.caixaGestao);
    const v = await loadResultado(OUT(), NOW);
    // Contas em ordem de nome (listBankAccounts).
    expect(v.contas.map((c) => [c.name, c.saldoCents])).toEqual([["Cofre", 500], ["Itaú", 10000 + 7000 + 3000 - 4000]]);
  });
});

describe("Resultado: permissão", () => {
  it("quem lê precisa de valores.ver (dado de dinheiro)", () => {
    expect(() => assertCanSeeResultado(["relatorios.ver"])).toThrow(UserFacingError);
    expect(() => assertCanSeeResultado(["valores.ver"])).not.toThrow();
  });
});
