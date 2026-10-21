// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ClientPackageItem } from "@/server/queries/avec";
import { PackagesList } from "./packages-list";

afterEach(cleanup);

const pkg = (over: Partial<ClientPackageItem>): ClientPackageItem => ({
  id: "k1", contactId: null, clientName: "Cliente Teste", phone: null, packageName: "Pacote 10 Escovas", serviceLabel: "Escova",
  totalSessions: 10, usedSessions: 9, remaining: 1, priceCents: 50000, purchasedOn: "2026-09-01", validUntil: "2026-11-01",
  nextAppointmentAt: null, situation: "acabando", endingSoon: true, expiringSoon: true, rowIds: ["k1"], services: [{ id: "k1", label: "Escova", usedSessions: 9, totalSessions: 10 }], ...over,
});

it("sessões usadas/total em barra, Acabando e Vence em 30 dias, validade e próximo horário", () => {
  render(<PackagesList items={[pkg({})]} tab="ativos" q="" today="2026-10-14" withValues={false} hrefFor={() => "/pacotes"} />);
  const bar = screen.getByRole("meter", { name: "9 de 10 sessões usadas" });
  expect((bar.firstChild as HTMLElement).style.width).toBe("90%");
  const card = within(screen.getByRole("list", { name: "Pacotes" }));
  expect(card.getByText("Acabando")).toBeTruthy();
  expect(card.getByText("Vence em 30 dias")).toBeTruthy();
  expect(screen.getByText("falta 1")).toBeTruthy();
  expect(screen.getByText("vence em 18 dias")).toBeTruthy();
  expect(screen.getByText("Nenhum marcado")).toBeTruthy();
  expect(screen.queryByText(/R\$/)).toBeNull(); // valor só para quem vê valores
});

it("valor aparece para quem vê valores", () => {
  render(<PackagesList items={[pkg({})]} tab="ativos" q="" today="2026-10-14" withValues hrefFor={() => "/"} />);
  expect(screen.getByText(/R\$\s?500/)).toBeTruthy();
});

it("nome da cliente que veio do Avec em MAIÚSCULAS aparece em Título (o banco guarda o original)", () => {
  render(<PackagesList items={[pkg({ clientName: "MARIA DA SILVA SOUZA" })]} tab="ativos" q="" today="2026-10-14" withValues={false} hrefFor={() => "/"} />);
  expect(screen.getByText("Maria da Silva Souza")).toBeTruthy();
  expect(screen.queryByText("MARIA DA SILVA SOUZA")).toBeNull();
});

it("compra do Avec em várias linhas: um cartão, preço uma vez, cada serviço com o seu uso", () => {
  render(<PackagesList items={[pkg({ packageName: "Combo Manutenção Método Fiaes", serviceLabel: null, totalSessions: 4, usedSessions: 0, remaining: 4, priceCents: 800000,
    rowIds: ["a", "b"], services: [{ id: "a", label: "Finalização Método Fiaes", usedSessions: 0, totalSessions: 4 }, { id: "b", label: "Sessão de Pacote Método", usedSessions: 0, totalSessions: 4 }], situation: "ativo", endingSoon: false, expiringSoon: false })]}
    tab="ativos" q="" today="2026-10-14" withValues hrefFor={() => "/"} />);
  expect(screen.getAllByRole("listitem").filter((li) => li.parentElement?.getAttribute("aria-label") === "Pacotes")).toHaveLength(1);
  const svc = within(screen.getByRole("list", { name: "Serviços do pacote Combo Manutenção Método Fiaes" }));
  expect(svc.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Finalização Método Fiaes0 de 4", "Sessão de Pacote Método0 de 4"]);
  expect(screen.getByRole("meter", { name: "0 de 4 sessões usadas" })).toBeTruthy();
  expect(screen.getAllByText(/R\$\s?8\.000/)).toHaveLength(1);
});
