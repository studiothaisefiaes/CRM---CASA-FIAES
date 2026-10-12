import { it, expect } from "vitest";
import { reportsSubtitle, simulatorDefaults } from "./demo";

it("Relatórios: números reais fora da demonstração", () => {
  expect(reportsSubtitle("Este mês", false)).toBe("Este mês · números reais do CRM");
});
it("Relatórios: na demonstração diz que os dados são de demonstração", () => {
  expect(reportsSubtitle("7 dias", true)).toBe("7 dias · dados de demonstração");
});
it("simulador da demonstração vem com um número fictício (faixa +55 71 90000-xxxx)", () => {
  expect(simulatorDefaults(true).phone.replace(/\D/g, "")).toMatch(/^7190000\d{4}$/);
  expect(simulatorDefaults(false).phone).not.toBe(simulatorDefaults(true).phone);
});
