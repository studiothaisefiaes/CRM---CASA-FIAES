// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AppointmentItem, ClientPackageItem, SaleHistoryItem } from "@/server/queries/avec";
import { ClientHistory, ClientPackages, UpcomingAppointments } from "./contact-avec";

afterEach(cleanup);
const NOW = Date.UTC(2026, 9, 14, 15, 0); // 14/10/2026 12:00 em Salvador

const appt = (o: Partial<AppointmentItem>): AppointmentItem => ({
  id: "a1", startsAt: new Date(Date.UTC(2026, 9, 15, 17, 30)).toISOString(), durationMin: 60, status: "confirmado", avecStatus: null, contactId: "c", clientName: "Ana",
  phone: null, professionalId: null, professionalName: "MAIARA", serviceId: null, serviceLabel: "Escova", priceCents: null, notes: null, origin: "avec", createdByName: null, dealId: null,
  visitId: null, fitIn: false, outsideHours: false, anyPro: false, confirmedVia: null, cancelReason: null, cancelNote: null, crmTouchedAt: null, bookedByName: null, waitWindow: null, professionalColor: null, professionalPhotoPath: null, preference: null, ...o,
});
const pkg = (o: Partial<ClientPackageItem>): ClientPackageItem => ({
  id: "p1", contactId: "c", clientName: "Ana", phone: null, packageName: "Hidratação 10x", serviceLabel: "Hidratação", totalSessions: 10, usedSessions: 3, remaining: 7,
  priceCents: null, purchasedOn: "2026-09-01", validUntil: "2027-03-05", nextAppointmentAt: null, situation: "ativo", endingSoon: false, expiringSoon: false, rowIds: ["p1"], services: [{ id: "p1", label: "Hidratação", usedSessions: 3, totalSessions: 10 }], ...o,
});
const sale = (o: Partial<SaleHistoryItem>): SaleHistoryItem => ({
  id: "s1", soldOn: "2026-10-10", comanda: "101", item: "Corte", kind: "servico", category: null, professionalName: "MAIARA", qty: 1, valueCents: null, discountCents: null, totalCents: null, fromPackage: false, ...o,
});

describe("ficha da cliente: o que veio do Avec", () => {
  it("próximos horários: quando, serviço, profissional e status; vazio avisa", () => {
    render(<UpcomingAppointments items={[appt({})]} now={NOW} />);
    const list = screen.getByTestId("proximos-horarios");
    expect(list.textContent).toContain("amanhã 14:30 · Escova");
    expect(list.textContent).toContain("Com Maiara · 60 min");
    expect(list.textContent).toContain("Confirmado");
    expect(list.textContent).not.toContain("R$");
    cleanup();
    render(<UpcomingAppointments items={[]} now={NOW} />);
    expect(screen.getByText("Nenhum horário marcado.")).toBeTruthy();
  });

  it("pacotes: em uso primeiro, barra 'N de M', validade com 'vence em N dias', sessões usadas com data/serviço/profissional; encerrados recolhidos", () => {
    const sessions = new Map([["p1", [{ id: "s1", day: "2026-10-10", service: "Hidratação", professional: "Maiara" }, { id: "s2", day: "2026-09-20", service: "Hidratação", professional: null }]]]);
    render(<ClientPackages items={[pkg({ id: "p2", packageName: "Escova 5x", totalSessions: 5, usedSessions: 5, remaining: 0, situation: "esgotado" }), pkg({ validUntil: "2026-11-13", expiringSoon: true, situation: "vencendo" })]}
      sessions={sessions} today="2026-10-14" money={false} />);
    const bar = screen.getByRole("meter", { name: "3 de 10 sessões usadas" });
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("30%");
    const open = screen.getByTestId("pacotes");
    expect(open.textContent).toContain("faltam 7");
    expect(open.textContent).toContain("13/11/2026");
    expect(open.textContent).toContain("vence em 30 dias");
    expect(within(open).getByText("Comprado em").nextElementSibling?.textContent).toBe("01/09/2026");
    expect(open.textContent).not.toContain("Escova 5x");
    expect(open.textContent).not.toContain("R$");
    const used = within(open).getByRole("list", { name: "Sessões usadas de Hidratação 10x" });
    expect(used.textContent).toContain("10/10/2026");
    expect(used.textContent).toContain("Com Maiara");
    expect(used.textContent).toContain("Profissional não informada");
    expect(screen.getByText("Encerrados (1)")).toBeTruthy();
    cleanup();
    render(<ClientPackages items={[pkg({ priceCents: 48_000 })]} sessions={new Map()} today="2026-10-14" money />);
    expect(screen.getByTestId("pacotes").textContent).toContain("R$ 480,00");
    expect(screen.getByTestId("pacotes").textContent).toContain("Nenhuma sessão usada ainda");
    cleanup();
    render(<ClientPackages items={[]} sessions={new Map()} today="2026-10-14" money={false} />);
    expect(screen.getByText("Sem pacote")).toBeTruthy();
  });

  it("pacote do Avec em várias linhas: um cartão (1 em uso), cada serviço com o seu uso, preço uma vez", () => {
    render(<ClientPackages items={[pkg({ packageName: "Combo Manutenção Método Fiaes", serviceLabel: null, totalSessions: 4, usedSessions: 0, remaining: 4, priceCents: 800000,
    rowIds: ["a", "b"], services: [{ id: "a", label: "Finalização Método Fiaes", usedSessions: 0, totalSessions: 4 }, { id: "b", label: "Sessão de Pacote Método", usedSessions: 0, totalSessions: 4 }] })]} sessions={new Map()} today="2026-10-14" money />);
    expect(screen.getByRole("heading", { name: /Pacotes/ }).textContent).toContain("(1 em uso)");
    const svc = within(screen.getByRole("list", { name: "Serviços do pacote Combo Manutenção Método Fiaes" }));
    expect(svc.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Finalização Método Fiaes0 de 4", "Sessão de Pacote Método0 de 4"]);
    expect(screen.getByRole("meter", { name: "0 de 4 sessões usadas" })).toBeTruthy();
    expect(screen.getAllByText(/R\$\s?8\.000/)).toHaveLength(1);
  });

  it("atendimentos e compras por dia: item e profissional; valor só quando veio do servidor", () => {
    const items = [sale({}), sale({ id: "s2", item: "Hidratação", professionalName: null, fromPackage: true }), sale({ id: "s3", soldOn: "2026-09-01", item: "Shampoo", kind: "produto" })];
    render(<ClientHistory items={items} limit={200} />);
    const box = screen.getByTestId("atendimentos");
    expect(within(box).getByText("10/10/2026")).toBeTruthy();
    expect(within(box).getByText("01/09/2026")).toBeTruthy();
    expect(box.textContent).toContain("Do pacote");
    expect(box.textContent).toContain("Profissional não informada");
    expect(box.textContent).not.toContain("R$");
    cleanup();
    render(<ClientHistory items={[sale({ totalCents: 8_000 }), sale({ id: "s2", item: "Escova", totalCents: 5_000 })]} limit={200} />);
    expect(screen.getByTestId("atendimentos").textContent).toContain("R$ 130,00");
  });
});
