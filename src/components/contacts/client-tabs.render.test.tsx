// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ClientTabs } from "./client-tabs";
afterEach(cleanup);

it("abas Todas · Método Fiaes · Serviços gerais com a contagem; a aba ligada fica marcada e as outras mantêm a busca", () => {
  render(<ClientTabs current="metodo" counts={{ todas: 120, metodo: 34, gerais: 61 }} hrefFor={(t) => `/contatos?q=ana${t ? `&aba=${t}` : ""}`} />);
  const tabs = screen.getAllByRole("link");
  expect(tabs.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
    ["Todas120", "/contatos?q=ana", null], ["Método Fiaes®34", "/contatos?q=ana&aba=metodo", "page"], ["Serviços gerais61", "/contatos?q=ana&aba=gerais", null],
  ]);
  expect(screen.getByRole("navigation", { name: "Tipo de cliente" })).toBeTruthy();
});
