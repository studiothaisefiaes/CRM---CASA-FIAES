// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { AgendaToday } from "./agenda-today";
import type { TodayAgendaItem } from "@/server/queries/today";
afterEach(cleanup);

const item = (o: Partial<TodayAgendaItem> = {}): TodayAgendaItem => ({ key: "ag:a1", appointmentId: "a1", dealId: null, name: "Paula Souza", at: "2026-10-13T12:00:00.000Z", noTime: false,
  professional: "Priscila", service: "Escova", state: "confirmado", stateLabel: "Confirmado", href: "/agenda?destaque=a1", ...o });

it("'Agenda de hoje': hora, nome, serviço com a profissional e o estado; a linha abre o horário na Agenda", () => {
  render(<AgendaToday items={[item(), item({ key: "ag:a2", appointmentId: "a2", name: "Rita", professional: null, state: "chegou", stateLabel: "Chegou, na Casa", href: "/agenda?destaque=a2" })]} />);
  const bloco = screen.getByRole("region", { name: "Agenda de hoje" });
  expect(bloco.textContent).toContain("2");
  const paula = screen.getByRole("link", { name: /Paula Souza/ });
  expect(paula.getAttribute("href")).toBe("/agenda?destaque=a1");
  expect(within(paula).getByText("9:00")).toBeTruthy();
  expect(within(paula).getByText("Escova · com Priscila")).toBeTruthy();
  expect(within(paula).getByText("Confirmado")).toBeTruthy();
  expect(within(screen.getByRole("link", { name: /Rita/ })).getByText("Chegou, na Casa")).toBeTruthy();
  expect(bloco.textContent).toContain("1 na Casa");
});

it("dia sem horário: o bloco fica, apagado, com a frase", () => {
  render(<AgendaToday items={[]} />);
  const bloco = screen.getByRole("region", { name: "Agenda de hoje" });
  expect(bloco.getAttribute("data-vazio")).toBe("sim");
  expect(bloco.textContent).toContain("Nenhum horário na Agenda hoje.");
});

it("mais de 3: a prévia mostra os 3 próximos que ainda pedem algo (os encerrados ficam no painel) e o painel mostra todos", () => {
  const items = [
    item({ key: "1", name: "Encerrada", state: "pago", stateLabel: "Finalizado" }),
    item({ key: "2", name: "Faltosa", state: "faltou", stateLabel: "Faltou" }),
    item({ key: "3", name: "Atrasada", state: "sembaixa", stateLabel: "Sem baixa, atrasada" }),
    item({ key: "4", name: "Atendendo", state: "atendendo", stateLabel: "Atendendo" }),
    item({ key: "5", name: "Depois", state: "marcado", stateLabel: "Marcado" }),
    item({ key: "6", name: "Bem depois", state: "marcado", stateLabel: "Marcado" }),
  ];
  render(<AgendaToday items={items} />);
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringContaining("Atrasada"), expect.stringContaining("Atendendo"), expect.stringContaining("Depois")]);
  expect(screen.getByRole("region", { name: "Agenda de hoje" }).textContent).toContain("1 sem desfecho");
  fireEvent.click(screen.getByRole("button", { name: "Ver todos: Agenda de hoje" }));
  expect(screen.getByRole("dialog").querySelectorAll("li a")).toHaveLength(6);
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Abrir a Agenda" }).getAttribute("href")).toBe("/agenda");
});
