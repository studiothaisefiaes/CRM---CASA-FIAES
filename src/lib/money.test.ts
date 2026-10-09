import { describe, it, expect } from "vitest";
import { parseBRL, formatBRL } from "./money";

describe("parseBRL", () => {
  it.each([
    ["1.158,50", 115850], ["1158,50", 115850], ["1158.50", 115850], ["R$ 1.158,50", 115850],
    ["1.158", 115800], ["1158", 115800], ["0,5", 50], ["12.345.678,90", 1234567890], [" 99 ", 9900],
  ])("%s → %i centavos", (i, c) => expect(parseBRL(i)).toEqual({ ok: true, cents: c }));
  it.each(["", "abc", "1,2,3", "-10", "1.15.8,50"])("%s é inválido", (i) => expect(parseBRL(i).ok).toBe(false));
  it("formata com espaço normal", () => expect(formatBRL(115850)).toBe("R$ 1.158,50"));
});
