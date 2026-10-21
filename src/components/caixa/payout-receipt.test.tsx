// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RECIBO_TEXTO_SUGERIDO } from "@/lib/caixa-recursos";
import type { PayoutReceipt as Receipt } from "@/lib/payouts";
import { PayoutReceipt } from "./payout-receipt";

afterEach(cleanup);
const REC: Receipt = {
  id: "r1", number: 1, professionalId: "p1", name: "Ana", fromDay: "2026-09-20", untilDay: "2026-09-30",
  lines: [
    { kind: "item", id: "i1", day: "2026-09-20", comandaNumber: 3, clientName: "Paula Souza", label: "Corte", commissionCents: 4800 },
    { kind: "assistente", id: "a1", day: "2026-09-21", comandaNumber: 5, clientName: "Rita Lima", label: "Escova (assistente de Bia)", commissionCents: 700 },
  ],
  adjustments: [
    { id: "j1", kind: "bonus", day: "2026-09-28", valueCents: 500, note: "Meta" },
    { id: "j2", kind: "vale", day: "2026-09-25", valueCents: 1000, note: "Adiantamento" },
    { id: "j3", kind: "desconto", day: "2026-09-26", valueCents: 200, note: "Aluguel da cadeira" },
  ],
  pending: [],
  totals: { commissionCents: 5500, bonusCents: 500, valesCents: 1000, descontosCents: 200, netCents: 4800 },
  paidAt: "2026-10-01T13:00:00.000Z", paidByName: "Thaíse", carriedCents: 0, cancelledAt: null, cancelReason: null, note: null,
};
/** O Intl usa espaço não separável. */
const norm = (t: string | null | undefined) => (t ?? "").replace(/\s/g, " ");

it("mostra o número, o período, cada parte e o total pago, sem o valor do serviço", () => {
  render(<PayoutReceipt receipt={REC} reciboTexto={RECIBO_TEXTO_SUGERIDO} />);
  const r = screen.getByRole("article", { name: "Recibo nº 1" });
  expect(within(r).getByRole("heading", { name: "Recibo nº 1" })).toBeTruthy();
  const text = norm(r.textContent);
  expect(text).toContain("Ana");
  expect(text).toContain("20/09/2026 a 30/09/2026");
  for (const t of ["Comissões", "Como assistente", "Bônus", "Vales", "Desconto na comissão", "Total pago"]) expect(within(r).getAllByText(t).length).toBeGreaterThan(0);
  expect(text).not.toContain("Saldo levado");
  const total = within(r).getByTestId("total-pago");
  expect(norm(total.textContent)).toContain("R$ 48,00");
  expect(text).toContain("Corte");
  expect(text).toContain("Escova (assistente de Bia)");
  expect(text).toContain("Aluguel da cadeira");
  // Nunca o valor do serviço (o Corte foi de R$ 120).
  expect(text).not.toContain("120");
  expect(text).toContain("Thaíse");
});

it("saldo levado só quando há; recibo desfeito diz quando e o motivo", () => {
  render(<PayoutReceipt receipt={{ ...REC, totals: { ...REC.totals, valesCents: 6700, netCents: 0 }, carriedCents: 900, cancelledAt: "2026-10-02T13:00:00.000Z", cancelReason: "pago errado" }} reciboTexto={RECIBO_TEXTO_SUGERIDO} />);
  const text = norm(screen.getByRole("article").textContent);
  expect(text).toContain("Saldo levado");
  expect(text).toContain("R$ 9,00");
  expect(text).toMatch(/Pagamento desfeito em 02\/10\/2026.*pago errado/);
});

it("o texto do recibo vem de Configurações › Caixa, com as variáveis preenchidas", () => {
  const { rerender } = render(<PayoutReceipt receipt={REC} reciboTexto={RECIBO_TEXTO_SUGERIDO} />);
  expect(norm(screen.getByTestId("recibo-texto").textContent)).toBe("Recebi da Casa Fiaes R$ 48,00 de comissão de 20/09/2026 a 30/09/2026, conforme o recibo nº 1. Ana");
  rerender(<PayoutReceipt receipt={REC} reciboTexto="Eu, {profissional}, recebi {total} ({periodo}). Recibo {numero}." />);
  expect(norm(screen.getByTestId("recibo-texto").textContent)).toBe("Eu, Ana, recebi R$ 48,00 (20/09/2026 a 30/09/2026). Recibo 1.");
});
