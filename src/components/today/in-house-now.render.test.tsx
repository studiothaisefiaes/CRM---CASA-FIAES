// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { InHouseNow } from "./in-house-now";
afterEach(cleanup);

const item = (o: object = {}) => ({ key: "v1", contactId: "c1", dealId: "d1", name: "PAULA SOUZA", hasAvatar: true, service: "Corte", professional: "Ana", since: "2026-10-15T12:55:00.000Z", started: true, ...o });

it("'Na Casa agora': foto, nome, serviço, profissional e desde quando; o nome abre a conversa", () => {
  render(<InHouseNow items={[item(), item({ key: "v2", contactId: null, dealId: null, name: "Walk-in Rita", hasAvatar: false, professional: null, started: false })]} />);
  expect(screen.getByRole("heading", { name: /Na Casa agora/ })).toBeTruthy();
  expect(document.querySelector('img[src="/api/avatar/c1"]')).toBeTruthy();
  expect(screen.getByRole("link", { name: /Paula Souza/ }).getAttribute("href")).toBe("/atendimento?lead=d1");
  expect(screen.getByText("Corte · com Ana")).toBeTruthy();
  expect(screen.getByText("em atendimento · desde 9:55")).toBeTruthy();
  expect(screen.getByText("Walk-in Rita")).toBeTruthy();
  expect(screen.getByText("chegou · desde 9:55")).toBeTruthy();
});

it("ninguém na Casa: o bloco fica, apagado, com a frase", () => {
  render(<InHouseNow items={[]} />);
  const bloco = screen.getByRole("region", { name: "Na Casa agora" });
  expect(bloco.getAttribute("data-vazio")).toBe("sim");
  expect(bloco.textContent).toContain("Ninguém na Casa agora.");
});

it("serviço e profissional em Título (vêm do Avec em MAIÚSCULAS)", () => {
  render(<InHouseNow items={[item({ service: "MANUTENÇÃO PROTESE CAPILAR", professional: "MAIARA" })]} />);
  expect(screen.getByText("Manutenção Protese Capilar · com Maiara")).toBeTruthy();
});

it("mais de 3 na Casa: a prévia mostra 3 e o painel todas", () => {
  render(<InHouseNow items={Array.from({ length: 5 }, (_, i) => item({ key: `v${i}`, contactId: `c${i}`, dealId: `d${i}`, name: `Cliente ${i}` }))} />);
  expect(screen.getAllByRole("link", { name: /Cliente/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Ver todos: Na Casa agora" }));
  expect(screen.getByRole("dialog").querySelectorAll("a")).toHaveLength(5);
});
