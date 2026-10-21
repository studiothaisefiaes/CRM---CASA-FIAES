// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
import { ConfigIndex } from "./config-index";
import { DangerGate } from "./danger-gate";

afterEach(cleanup);
const ALL = ["config.diaadia", "config.sistema", "equipe.gerir", "nota.configurar"];

it("mostra só o grupo escolhido, com a frase e o estado ligado/desligado de cada item", () => {
  render(<ConfigIndex perms={ALL} group="mensagens" states={{ "fora-do-horario": { text: "Ligada", on: true }, "boas-vindas": { text: "Desligada", on: false } }} />);
  expect(screen.getByRole("heading", { name: "Mensagens automáticas" })).toBeTruthy();
  const fora = screen.getByRole("link", { name: /Resposta fora do horário/ });
  expect(fora.getAttribute("href")).toBe("/config/mensagens?parte=fora-do-horario");
  expect(within(fora).getByText("Ligada").closest("[data-state]")?.getAttribute("data-state")).toBe("ligado");
  expect(within(screen.getByRole("link", { name: /^Boas-vindas/ })).getByText("Desligada")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Etiquetas/ })).toBeNull(); // outro grupo
  expect(screen.getByText(/Tudo aqui pode mandar mensagem para cliente/)).toBeTruthy();
});

it("a busca acha por sinônimo em todos os grupos e diz quando não acha nada", () => {
  render(<ConfigIndex perms={ALL} group="casa" states={{}} />);
  const busca = screen.getByRole("searchbox", { name: "Procurar configuração" });
  fireEvent.change(busca, { target: { value: "robô" } });
  expect(screen.getByRole("link", { name: /Boas-vindas/ })).toBeTruthy();
  fireEvent.change(busca, { target: { value: "qr code" } });
  expect(screen.getByRole("link", { name: /Conexão do WhatsApp/ }).getAttribute("href")).toBe("/config/whatsapp");
  fireEvent.change(busca, { target: { value: "xyzw" } });
  expect(screen.getByText("Nada com “xyzw”.")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Limpar busca" }).at(-1)!);
  expect(screen.getByRole("heading", { name: "A Casa" })).toBeTruthy();
});

it("quem só tem o dia a dia não acha o que não pode abrir; Pessoas leva a quem recebe conversa nova", () => {
  render(<ConfigIndex perms={["config.diaadia"]} group="pessoas" states={{}} />);
  expect(screen.getByRole("link", { name: /^Pessoas\s*Quem usa/ }).getAttribute("href")).toBe("/config/distribuicao");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "whatsapp" } });
  expect(screen.getByText("Nada com “whatsapp”.")).toBeTruthy();
});

it("Área de cuidado: o formulário fica travado até a confirmação em duas etapas (sem digitar palavra)", () => {
  render(<DangerGate risk="Se desconectar, nada entra nem sai."><button>Desconectar</button></DangerGate>);
  const travado = () => screen.getByRole("button", { name: "Desconectar", hidden: true }).closest("[aria-disabled]")!;
  expect(travado().hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Quero mexer aqui" }));
  expect(travado().hasAttribute("inert")).toBe(true); // só a primeira etapa
  fireEvent.click(screen.getByRole("button", { name: "Não" }));
  fireEvent.click(screen.getByRole("button", { name: "Quero mexer aqui" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim, liberar" }));
  expect(travado().hasAttribute("inert")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Travar de novo" }));
  expect(travado().hasAttribute("inert")).toBe(true);
});
