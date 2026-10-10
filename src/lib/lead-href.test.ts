import { expect, it } from "vitest";
import { leadHref } from "./lead-href";

it("aponta para o lead aberto na Fila", () => {
  expect(leadHref("abc")).toBe("/atendimento?lead=abc");
  expect(leadHref(null)).toBe("/atendimento");
});
