import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import type { Actor } from "../agenda/actor";
import { getFinanceiroConfig, saveFinanceiroConfig } from "./config";
import { getMethodAccounts, listBankAccounts, listCategories, saveBankAccount, saveCategory, saveMethodAccounts } from "./cadastros";
import { cancelExpense, createExpense, listExpenses, payExpense, undoExpensePayment } from "./despesas";

const NOW = new Date("2026-10-18T12:00:00Z");
let s: Awaited<ReturnType<typeof setupCaixa>>;
let cat: { id: string };
const base = () => ({ title: "Aluguel da loja", categoryId: cat.id, amountCents: 450000, dueOn: "2026-10-31" });
const without = (a: Actor, ...p: string[]): Actor => ({ ...a, perms: a.perms.filter((x) => !p.includes(x)) });
const logs = async (action: string) => (await db.select().from(auditLog).where(eq(auditLog.action, action))).map((a) => a.data);
const OFF = "Contas a pagar está desligado em Configurações › Financeiro.";

beforeEach(async () => {
  await resetDb();
  s = await setupCaixa();
  cat = await saveCategory({ name: "Aluguel", dreGroup: "ocupacao" }, s.caixaGestao);
});

describe("lançar e repetir", () => {
  it("repetir 3 meses cria 3 parcelas da mesma série, com competência do mês de cada uma", async () => {
    const { ids } = await createExpense({ ...base(), repeatMonths: 3 }, s.caixaGestao);
    const rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(rows.map((r) => [r.dueOn, r.competence, r.installment, r.installments])).toEqual([
      ["2026-10-31", "2026-10-01", 1, 3], ["2026-11-30", "2026-11-01", 2, 3], ["2026-12-31", "2026-12-01", 3, 3]]);
    expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
    expect(ids).toHaveLength(3);
    expect(rows[0].categoryName).toBe("Aluguel");
  });

  it("pagar, desfazer e cancelar 'esta e as próximas'; tudo auditado", async () => {
    const { ids } = await createExpense({ ...base(), repeatMonths: 3 }, s.caixaGestao);
    await payExpense(ids[0], { paidOn: "2026-10-18", paidCents: 450000, bankAccountId: null, method: "pix" }, s.caixaGestao);
    let rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(rows[0].status).toBe("paga");
    await undoExpensePayment(ids[0], s.caixaGestao);
    rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(rows[0].status).toBe("em_aberto");
    expect(rows[0].paidOn).toBeNull();
    await cancelExpense(ids[1], { reason: "Contrato encerrado", scope: "proximas" }, s.caixaGestao);
    rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(rows.map((r) => r.id)).toEqual([ids[0]]);
    for (const a of ["despesa_lancada", "despesa_paga", "despesa_pagamento_desfeito", "despesa_cancelada"]) expect((await logs(a)).length).toBeGreaterThan(0);
  });

  it("cancelar 'próximas' não cancela parcela já paga", async () => {
    const { ids } = await createExpense({ ...base(), repeatMonths: 3 }, s.caixaGestao);
    await payExpense(ids[2], { paidOn: "2026-10-18", paidCents: 450000, bankAccountId: null, method: "boleto" }, s.caixaGestao);
    await cancelExpense(ids[1], { reason: "Mudou", scope: "proximas" }, s.caixaGestao);
    const rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(rows.map((r) => r.id)).toEqual([ids[0], ids[2]]);
  });

  it("valida: valor > 0, título, categoria ativa, repetir de 1 a 24, motivo de cancelamento", async () => {
    await expect(createExpense({ ...base(), amountCents: 0 }, s.caixaGestao)).rejects.toThrow("Digite o valor da despesa.");
    await expect(createExpense({ ...base(), title: " " }, s.caixaGestao)).rejects.toThrow("Escreva o que é a despesa.");
    await expect(createExpense({ ...base(), repeatMonths: 25 }, s.caixaGestao)).rejects.toThrow("Repita de 1 a 24 meses.");
    await saveCategory({ id: cat.id, name: "Aluguel", dreGroup: "ocupacao", active: false }, s.caixaGestao);
    await expect(createExpense(base(), s.caixaGestao)).rejects.toThrow("Escolha uma categoria ativa.");
    await saveCategory({ id: cat.id, name: "Aluguel", dreGroup: "ocupacao", active: true }, s.caixaGestao);
    const { ids } = await createExpense(base(), s.caixaGestao);
    await expect(cancelExpense(ids[0], { reason: " ", scope: "esta" }, s.caixaGestao)).rejects.toThrow("Escreva o motivo do cancelamento.");
  });
});

describe("permissões por ação, recusadas no servidor", () => {
  it("sem financeiro.lancar não lança", async () => {
    await expect(createExpense(base(), s.caixaRecepcao)).rejects.toThrow();
    await expect(createExpense(base(), without(s.caixaGestao, "financeiro.lancar"))).rejects.toThrow();
  });
  it("sem financeiro.pagar não paga nem desfaz; sem financeiro.cancelar não cancela", async () => {
    const { ids } = await createExpense(base(), s.caixaGestao);
    const pay = { paidOn: "2026-10-18", paidCents: 450000, bankAccountId: null, method: "pix" as const };
    await expect(payExpense(ids[0], pay, without(s.caixaGestao, "financeiro.pagar"))).rejects.toThrow();
    await payExpense(ids[0], pay, s.caixaGestao);
    await expect(undoExpensePayment(ids[0], without(s.caixaGestao, "financeiro.pagar"))).rejects.toThrow();
    await expect(cancelExpense(ids[0], { reason: "x", scope: "esta" }, without(s.caixaGestao, "financeiro.cancelar"))).rejects.toThrow();
  });
  it("sem financeiro.cadastros não edita categoria, conta bancária nem conta por forma", async () => {
    const a = without(s.caixaGestao, "financeiro.cadastros");
    await expect(saveCategory({ name: "Nova", dreGroup: "outras" }, a)).rejects.toThrow();
    await expect(saveBankAccount({ name: "Itaú", openingCents: 0 }, a)).rejects.toThrow();
    await expect(saveMethodAccounts({}, a)).rejects.toThrow();
  });
  it("salvar a configuração pede config.sistema", async () => {
    await expect(saveFinanceiroConfig({ ...(await getFinanceiroConfig()), venceEmDias: 3 }, without(s.caixaGestao, "config.sistema"))).rejects.toThrow();
  });
});

describe("configuração muda o comportamento", () => {
  it("desligar Contas a pagar recusa as escritas, mas não os cadastros nem a lista", async () => {
    const { ids } = await createExpense(base(), s.caixaGestao);
    await saveFinanceiroConfig({ ...(await getFinanceiroConfig()), contasAPagar: false }, s.caixaGestao);
    await expect(createExpense(base(), s.caixaGestao)).rejects.toThrow(OFF);
    await expect(payExpense(ids[0], { paidOn: "2026-10-18", paidCents: 1, bankAccountId: null, method: "pix" }, s.caixaGestao)).rejects.toThrow(OFF);
    await expect(undoExpensePayment(ids[0], s.caixaGestao)).rejects.toThrow(OFF);
    await expect(cancelExpense(ids[0], { reason: "x", scope: "esta" }, s.caixaGestao)).rejects.toThrow(OFF);
    await expect(saveCategory({ name: "Nova", dreGroup: "outras" }, s.caixaGestao)).resolves.toBeTruthy();
    expect(await listExpenses({ from: "2026-10-01", to: "2026-10-31" }, NOW)).toHaveLength(1);
  });
  it("repetirMaxMeses e venceEmDias valem na hora, e a mudança é auditada com de/para", async () => {
    await saveFinanceiroConfig({ contasAPagar: true, resultado: true, venceEmDias: 20, repetirMaxMeses: 6 }, s.caixaGestao);
    await expect(createExpense({ ...base(), repeatMonths: 7 }, s.caixaGestao)).rejects.toThrow("Repita de 1 a 6 meses.");
    await createExpense({ ...base(), dueOn: "2026-11-05" }, s.caixaGestao);
    expect((await listExpenses({ from: "2026-11-01", to: "2026-11-30" }, NOW))[0].status).toBe("vence_7d");
    const [l] = await logs("financeiro_configurado");
    expect(l).toMatchObject({ de: { venceEmDias: 7, repetirMaxMeses: 24 }, para: { venceEmDias: 20, repetirMaxMeses: 6 } });
  });
  it("valores fora do limite são recusados", async () => {
    await expect(saveFinanceiroConfig({ contasAPagar: true, resultado: true, venceEmDias: 61, repetirMaxMeses: 24 }, s.caixaGestao)).rejects.toThrow();
    await expect(saveFinanceiroConfig({ contasAPagar: true, resultado: true, venceEmDias: 7, repetirMaxMeses: 0 }, s.caixaGestao)).rejects.toThrow();
  });
});

describe("cadastros", () => {
  it("categoria e conta bancária: nome único sem diferenciar maiúsculas; conta por forma de pagamento", async () => {
    await expect(saveCategory({ name: "aluguel", dreGroup: "ocupacao" }, s.caixaGestao)).rejects.toThrow("Já existe uma categoria com esse nome.");
    expect((await listCategories()).map((c) => c.name)).toContain("Aluguel");
    const acc = await saveBankAccount({ name: "Itaú", bank: "Itaú", openingCents: 1000 }, s.caixaGestao);
    await expect(saveBankAccount({ name: "ITAÚ", openingCents: 0 }, s.caixaGestao)).rejects.toThrow("Já existe uma conta com esse nome.");
    expect((await listBankAccounts()).map((a) => a.name)).toEqual(["Itaú"]);
    await saveMethodAccounts({ pix: acc.id }, s.caixaGestao);
    expect(await getMethodAccounts()).toEqual({ pix: acc.id });
    expect((await logs("conta_por_forma_salva")).length).toBe(1);
  });
});
