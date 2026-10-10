import { expect, it } from "vitest";
import { leadHref } from "./lead-href";

it("aponta para o lead aberto no funil (a T15 troca por /atendimento aqui)", () => {
  expect(leadHref("abc")).toBe("/funil?lead=abc");
  expect(leadHref(null)).toBe("/funil");
});
