// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("aba=financeiro&vista=notas") }));
import { salonRange } from "@/lib/salon-period";
import { NotasFiscaisTab } from "./notas-fiscais";

afterEach(cleanup);
const range = salonRange({ periodo: "livre", de: "2026-10-01", ate: "2026-10-31" }, new Date("2026-10-18T12:00:00Z"));

it("pergunta 'Que notas saíram?', duas seções, colunas e extrato da parceira", () => {
  const { container } = render(<NotasFiscaisTab range={range} notas={[{ id: "n1", comandaNumber: 12, day: "2026-10-05", kind: "nfse", environment: "teste", status: "rejeitada", amountCents: 12150, accessKey: null, rejectReason: "E160" }]}
    parceiras={[{ professionalId: "p", name: "Ana", legalName: "ANA SILVA ME", cnpj: "11222333000181", month: "2026-10", cents: 3240, comandas: 2 }]} />);
  expect(screen.getByRole("heading", { name: "Que notas saíram?" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Notas do período" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Para a nota das parceiras" })).toBeTruthy();
  for (const c of ["Comanda", "Dia", "Tipo", "Ambiente", "Situação", "Valor", "Mês", "Parceira", "CNPJ", "Comandas"]) expect(screen.getAllByText(c).length).toBeGreaterThan(0);
  expect(container.textContent).toContain("Rejeitada: E160");
  expect(container.textContent).toContain("11.222.333/0001-81");
  expect(container.textContent).toContain("outubro de 2026");
});
it("sem nada: frases vazias", () => {
  const { container } = render(<NotasFiscaisTab range={range} notas={[]} parceiras={[]} />);
  expect(container.textContent).toContain("Nenhuma nota neste período.");
  expect(container.textContent).toContain("Nenhuma cota de parceira neste período.");
});
