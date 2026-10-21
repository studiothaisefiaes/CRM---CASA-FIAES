import { describe, expect, it } from "vitest";
import { EXPENSE_STATUS_LABEL, expenseStatus, expenseStatusLabel, monthlyDueDates } from "./expense-status";
import { DEFAULT_FINANCEIRO_CONFIG, readFinanceiroConfig } from "./financeiro-settings";

describe("contas a pagar: datas e situação", () => {
  it("vencimento mensal mantém o dia e cai no último dia do mês curto", () => {
    expect(monthlyDueDates("2027-01-31", 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(monthlyDueDates("2028-01-31", 2)).toEqual(["2028-01-31", "2028-02-29"]);
  });
  it("situação: paga vence tudo; atrasada antes de hoje; até 7 dias; o resto em aberto", () => {
    expect(expenseStatus({ dueOn: "2026-10-01", paidOn: "2026-10-02" }, "2026-10-18")).toBe("paga");
    expect(expenseStatus({ dueOn: "2026-10-17", paidOn: null }, "2026-10-18")).toBe("atrasada");
    expect(expenseStatus({ dueOn: "2026-10-25", paidOn: null }, "2026-10-18")).toBe("vence_7d");
    expect(expenseStatus({ dueOn: "2026-10-26", paidOn: null }, "2026-10-18")).toBe("em_aberto");
  });
  it("a janela 'vence em até N dias' vem da configuração", () => {
    expect(expenseStatus({ dueOn: "2026-10-26", paidOn: null }, "2026-10-18", 10)).toBe("vence_7d");
    expect(expenseStatus({ dueOn: "2026-10-19", paidOn: null }, "2026-10-18", 0)).toBe("em_aberto");
    expect(expenseStatus({ dueOn: "2026-10-18", paidOn: null }, "2026-10-18", 0)).toBe("vence_7d");
    expect(EXPENSE_STATUS_LABEL.vence_7d).toBe("Vence em até 7 dias");
    expect(expenseStatusLabel("vence_7d", 10)).toBe("Vence em até 10 dias");
    expect(expenseStatusLabel("paga", 10)).toBe("Paga");
  });
});

describe("financeiro_config", () => {
  it("padrão e leitura tolerante", () => {
    expect(DEFAULT_FINANCEIRO_CONFIG).toEqual({ contasAPagar: true, resultado: true, venceEmDias: 7, repetirMaxMeses: 24 });
    expect(readFinanceiroConfig(undefined)).toEqual(DEFAULT_FINANCEIRO_CONFIG);
    expect(readFinanceiroConfig({ contasAPagar: false, venceEmDias: 10, repetirMaxMeses: 12 })).toEqual({ contasAPagar: false, resultado: true, venceEmDias: 10, repetirMaxMeses: 12 });
    expect(readFinanceiroConfig({ venceEmDias: 61, repetirMaxMeses: 0 })).toEqual(DEFAULT_FINANCEIRO_CONFIG);
    expect(readFinanceiroConfig({ venceEmDias: "x", repetirMaxMeses: 1.5, contasAPagar: "sim" })).toEqual(DEFAULT_FINANCEIRO_CONFIG);
    expect(readFinanceiroConfig({ venceEmDias: 0, repetirMaxMeses: 60 })).toMatchObject({ venceEmDias: 0, repetirMaxMeses: 60 });
  });
});
