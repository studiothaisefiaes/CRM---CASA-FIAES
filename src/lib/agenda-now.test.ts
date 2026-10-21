import { expect, it } from "vitest";
import { defaultBookingTime } from "./agenda-now";

it("hora inicial do Marcar: a próxima meia hora hoje (até 23:30); outro dia, 09:00", () => {
  const at = (h: number, m: number) => Date.UTC(2026, 9, 16, h + 3, m);
  expect(defaultBookingTime("2026-10-17", at(10, 7))).toBe("09:00");
  expect(defaultBookingTime("2026-10-16", at(10, 7))).toBe("10:30");
  expect(defaultBookingTime("2026-10-16", at(10, 30))).toBe("11:00");
  expect(defaultBookingTime("2026-10-16", at(23, 50))).toBe("23:30");
});
