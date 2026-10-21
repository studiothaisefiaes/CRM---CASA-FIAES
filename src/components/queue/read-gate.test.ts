import { expect, it } from "vitest";
import { canMarkReadNow } from "./read-gate";

it("só marca como lida com a aba visível E a janela em foco (conversa largada aberta na tela não engole o aviso)", () => {
  expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => true })).toBe(true);
  expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => false })).toBe(false);
  expect(canMarkReadNow({ visibilityState: "hidden", hasFocus: () => true })).toBe(false);
});
