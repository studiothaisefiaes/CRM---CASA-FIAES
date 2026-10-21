import { describe, expect, it } from "vitest";
import { CASH_DENOMINATIONS_CENTS, denominationLabel, sumDenominations } from "./cash-denominations";

describe("cédulas e moedas (Norte Vendas, lib/cashDenominations)", () => {
  it("de R$ 200 a R$ 0,01, em centavos", () => {
    expect(CASH_DENOMINATIONS_CENTS).toEqual([20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1]);
  });
  it("soma: quantidade × cédula; ignora cédula desconhecida e quantidade negativa ou quebrada", () => {
    expect(sumDenominations({ "20000": 1, "5000": 2, "25": 3, x: 9, "100": -1, "10": 1.5, "300": 4 })).toBe(30075);
    expect(sumDenominations({})).toBe(0);
  });
  it("rótulo: R$ 200 para cédula, R$ 0,25 para moeda", () => {
    expect(denominationLabel(20000)).toBe("R$ 200");
    expect(denominationLabel(100)).toBe("R$ 1");
    expect(denominationLabel(25)).toBe("R$ 0,25");
  });
});
