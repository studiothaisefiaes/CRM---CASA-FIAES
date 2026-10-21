// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { WorkspaceBar } from "./workspace-bar";

afterEach(cleanup);
const abas = () => within(screen.getByRole("navigation", { name: "Formas de ver as conversas" })).getAllByRole("link");

it("o título é Conversas e as abas são Fila · Quadro · Programadas (Jornada foi para Relatórios)", () => {
  render(<WorkspaceBar current="fila" quadro />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Conversas");
  expect(abas().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Fila", "/atendimento"], ["Quadro", "/funil"], ["Programadas", "/atendimento/programadas"]]);
  expect(screen.queryByRole("link", { name: /Jornada/ })).toBeNull();
});

it("a aba Programadas mostra o número ao lado e fica acesa na própria tela", () => {
  render(<WorkspaceBar current="programadas" quadro programadas={3} />);
  const p = abas().find((a) => a.getAttribute("href") === "/atendimento/programadas")!;
  expect(p.textContent).toBe("Programadas 3");
  expect(p.getAttribute("aria-current")).toBe("page");
});

it("sem permissão do Quadro, só Fila e Programadas", () => {
  render(<WorkspaceBar current="fila" />);
  expect(abas().map((a) => a.textContent)).toEqual(["Fila", "Programadas"]);
});

it("no celular o número sai da aba (a barra cabe em 390 px; a Fila já mostra 'Programadas N' embaixo das abas)", () => {
  render(<WorkspaceBar current="fila" quadro programadas={12} />);
  const p = abas().find((a) => a.getAttribute("href") === "/atendimento/programadas")!;
  expect(p.querySelector("b")!.className).toMatch(/max-lg:hidden/);
});
