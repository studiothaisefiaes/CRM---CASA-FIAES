import { it, expect } from "vitest";
import { previousMonthKey } from "./month-key";

it("o mês anterior, pelo horário de Salvador (virada de ano e 1º do mês de madrugada)", () => {
  expect(previousMonthKey(new Date("2026-11-01T09:00:00Z"))).toBe("2026-10");   // 1º/11 às 06:00 em Salvador
  expect(previousMonthKey(new Date("2026-11-01T02:00:00Z"))).toBe("2026-09");   // ainda 31/10 23:00 em Salvador
  expect(previousMonthKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-12");
  expect(previousMonthKey(new Date("2026-03-15T12:00:00Z"))).toBe("2026-02");
});
