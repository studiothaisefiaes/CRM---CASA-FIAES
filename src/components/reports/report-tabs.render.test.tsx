// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
import { ReportTabs } from "./report-tabs";
import { MoreReports } from "./more-reports";
afterEach(cleanup);
const ALL = ["relatorios.ver", "valores.ver", "comissao.ver", "jornada.ver", "config.sistema", "relatorios.avec", "atendimento.ver", "relatorios.salao"];

it("r66 #9: Relatórios só tem como abas o que mora na tela (estilo sublinhado); o que leva a outra página vira 'Abrir' em Mais relatórios", () => {
  render(<><ReportTabs value="visao" perms={ALL} /><MoreReports perms={ALL} /></>);
  const abas = screen.getAllByRole("tab").map((t) => t.textContent);
  expect(abas).not.toContain("Comissão");
  expect(abas).not.toContain("Jornada");
  expect(abas).not.toContain("Relatórios do Avec");
  expect(abas).toContain("Visão geral");
  expect(screen.getByRole("tab", { name: "Visão geral" }).className).toContain("border-b-2");
  expect(screen.queryByRole("link", { name: "Abrir Comissão" })).toBeNull(); // psico r68 #19: a porta da Comissão é uma só, no cabeçalho de Relatórios
  expect(screen.getByRole("link", { name: "Abrir Jornada" }).getAttribute("href")).toBe("/jornada");
});
it("dentro de Comissão não há falsa aba: só o link de volta", () => {
  render(<ReportTabs value="comissao" perms={ALL} />);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(screen.getByRole("link", { name: "← Relatórios" }).getAttribute("href")).toBe("/relatorios");
});
