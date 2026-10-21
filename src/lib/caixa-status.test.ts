import { expect, it } from "vitest";
import { cashStatus } from "./caixa-status";

it("cabeçalho do caixa: aberto com a hora de Salvador; fechado", () => {
  expect(cashStatus("Cati", { openedAt: "2026-10-15T12:05:00.000Z" })).toBe("Caixa de Cati · aberto 09:05");
  expect(cashStatus("Cati", null)).toBe("Caixa de Cati · fechado");
});
