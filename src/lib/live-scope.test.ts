import { expect, it } from "vitest";
import { scopesOf, shouldRefresh } from "./live-scope";

it("agenda_alterada só recarrega quem mostra a agenda", () => {
  expect(scopesOf({ type: "agenda_alterada", day: "2026-10-16" })).toEqual(["agenda"]);
  expect(shouldRefresh({ type: "agenda_alterada" }, ["agenda"])).toBe(true);
  expect(shouldRefresh({ type: "agenda_alterada" }, ["queue"])).toBe(false);
});
it("aviso desconhecido recarrega também a agenda (fail-open)", () => {
  expect(scopesOf({ type: "algo_novo" })).toContain("agenda");
  expect(scopesOf({ type: "algo_novo" })).toContain("caixa");
});
it("caixa_alterado recarrega a Agenda (selo R$) e o Caixa", () => {
  expect(scopesOf({ type: "caixa_alterado", day: "2026-10-16" })).toEqual(["agenda", "caixa"]);
});
