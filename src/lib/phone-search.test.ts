import { describe, expect, it } from "vitest";
import { phoneMatches, phoneSearchVariants } from "./phone-search";

const STORED = "+5571990000004";
describe("busca por telefone: com ou sem +55, DDD, máscara e o 9", () => {
  for (const typed of ["90000004", "990000004", "71 99000-0004", "(71) 99000-0004", "+55 71 99000-0004", "5571990000004", "071990000004", "(71) 9000-0004", "71 9 9000 0004", "0003", "650003"]) {
    it(`"${typed}" acha ${STORED}`, () => expect(phoneMatches(STORED, phoneSearchVariants(typed))).toBe(true));
  }
  it("número guardado sem o 9 também é achado digitando com o 9", () => expect(phoneMatches("+557190000004", phoneSearchVariants("71 99000-0004"))).toBe(true));
  it("outro número não casa", () => expect(phoneMatches(STORED, phoneSearchVariants("71 98765-0004"))).toBe(false));
  it("menos de 3 dígitos não busca por telefone", () => expect(phoneSearchVariants("a1")).toEqual([]));
});
