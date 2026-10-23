// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { money } from "@/lib/format";

const openById = vi.fn();
vi.mock("./comanda-provider", () => ({ useComanda: () => ({ openById, openForAppointment: vi.fn() }) }));
import { ComandasList } from "./comandas-list";

afterEach(cleanup);
const row = (o: Partial<Parameters<typeof ComandasList>[0]["rows"][number]>) => ({
  id: "c1", number: 7, day: "2026-10-12", clientName: "Paula Souza", contactId: null, status: "fechada", totalCents: 12000, paidCents: 12000, debtCents: 0,
  hasDebt: (o.debtCents ?? 0) > 0, professionals: ["Ana", "Bia"], openedAt: "", closedAt: null, closedByName: null, ...o,
});

it("mostra dia, nº, cliente, quem atendeu, total e situação; com dívida diz quanto; tocar abre a comanda", () => {
  render(<ComandasList rows={[row({}), row({ id: "c2", number: 8, debtCents: 3000, clientName: "Lia" }), row({ id: "c3", number: 9, totalCents: null, status: "aberta" })]} total={3} />);
  expect(screen.getAllByText("Ana, Bia")).toHaveLength(3);
  expect(screen.getByRole("list", { name: "Comandas" }).textContent).toContain(money(12000));
  expect(screen.getByRole("list", { name: "Comandas" }).textContent).toContain(`Deve ${money(3000)}`);
  expect(screen.getByText("—")).toBeTruthy(); // contagem cega
  fireEvent.click(screen.getByRole("button", { name: /Abrir comanda 7 de 12\/10 · Paula Souza/ }));
  expect(openById).toHaveBeenCalledWith("c1");
});

it("com mais que o limite avisa 'Mostrando N de M'; vazio diz que não há", () => {
  const { rerender } = render(<ComandasList rows={[row({})]} total={205} />);
  expect(screen.getByRole("status").textContent).toBe("Mostrando 1 de 205: refine a busca ou o período.");
  rerender(<ComandasList rows={[]} total={0} />);
  expect(screen.getByText("Nenhuma comanda com esses filtros.")).toBeTruthy();
});

it("revisão final: sem valores.ver a dívida vem sem valor e a comanda aparece 'Com dívida', nunca 'Paga'", () => {
  render(<ComandasList rows={[row({ totalCents: null, paidCents: null, debtCents: 0, hasDebt: true })]} />);
  expect(screen.getByText("Com dívida")).toBeTruthy();
  expect(screen.queryByText("Paga")).toBeNull();
});
