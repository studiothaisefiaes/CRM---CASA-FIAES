import { expect, it } from "vitest";
import { lastClosedPeriodEnd } from "./payout-period";

// 18/10/2026 é domingo
it("fim do último período fechado", () => {
  expect(lastClosedPeriodEnd("mensal", "2026-10-18")).toBe("2026-09-30");
  expect(lastClosedPeriodEnd("quinzenal", "2026-10-18")).toBe("2026-10-15");
  expect(lastClosedPeriodEnd("quinzenal", "2026-10-15")).toBe("2026-09-30");
  expect(lastClosedPeriodEnd("semanal", "2026-10-18")).toBe("2026-10-17");
  expect(lastClosedPeriodEnd("semanal", "2026-10-17")).toBe("2026-10-10");
  expect(lastClosedPeriodEnd("mensal", "2026-03-01")).toBe("2026-02-28");
  expect(lastClosedPeriodEnd("mensal", "2026-01-10")).toBe("2025-12-31");
});
