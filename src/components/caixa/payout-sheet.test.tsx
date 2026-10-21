// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Payable } from "@/lib/payouts";

const payableAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, data: null }));
const payCommissionAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, data: { id: "r1", number: 1, netCents: 4300 } }));
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({
  payableAction: (...a: unknown[]) => payableAction(...a), payCommissionAction: (...a: unknown[]) => payCommissionAction(...a),
}));
const toast = vi.fn();
const push = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
import { PayablesPanel } from "./payout-sheet";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const norm = (t: string | null | undefined) => (t ?? "").replace(/\s/g, " ");
const ANA: Payable = {
  professionalId: "p1", name: "Ana", fromDay: "2026-09-20", untilDay: "2026-09-30",
  lines: [{ kind: "item", id: "i1", day: "2026-09-20", comandaNumber: 3, clientName: "Paula Souza", label: "Corte", commissionCents: 4800 }],
  adjustments: [{ id: "j1", kind: "vale", day: "2026-09-25", valueCents: 1000, note: "Adiantamento" }, { id: "j2", kind: "bonus", day: "2026-09-28", valueCents: 500, note: "Meta" }],
  pending: [{ day: "2026-09-22", label: "Corte", why: "aguardando_quitacao" }],
  totals: { commissionCents: 4800, bonusCents: 500, valesCents: 1000, descontosCents: 0, netCents: 4300 },
};

it("A pagar: por profissional, até quando e o total; Pagar abre a prévia e Confirmar paga o valor visto", async () => {
  render(<PayablesPanel items={[ANA]} />);
  const row = screen.getByRole("listitem");
  expect(norm(row.textContent)).toContain("Ana");
  expect(norm(row.textContent)).toContain("até 30/09/2026");
  expect(norm(row.textContent)).toContain("R$ 43,00");
  fireEvent.click(within(row).getByRole("button", { name: "Pagar Ana" }));
  const sheet = await screen.findByRole("dialog");
  expect(norm(sheet.textContent)).toContain("Recibo (prévia)");
  expect(norm(sheet.textContent)).toContain("1 linha espera");
  await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Confirmar pagamento" })); });
  expect(payCommissionAction).toHaveBeenCalledWith({ professionalId: "p1", until: "2026-09-30", expectedNetCents: 4300, note: null });
  await waitFor(() => expect(push).toHaveBeenCalledWith("/caixa/comissao/recibo/r1"));
});

it("trocar a data recalcula a prévia; o valor mudou mostra o erro e recarrega", async () => {
  payableAction.mockResolvedValueOnce({ ok: true, data: { ...ANA, untilDay: "2026-09-25", adjustments: [ANA.adjustments[0]], totals: { ...ANA.totals, bonusCents: 0, netCents: 3800 } } });
  render(<PayablesPanel items={[ANA]} />);
  fireEvent.click(screen.getByRole("button", { name: "Pagar Ana" }));
  const sheet = await screen.findByRole("dialog");
  await act(async () => { fireEvent.change(within(sheet).getByLabelText("Até"), { target: { value: "2026-09-25" } }); });
  expect(payableAction).toHaveBeenCalledWith("p1", "2026-09-25");
  await waitFor(() => expect(norm(within(sheet).getByTestId("total-pago").textContent)).toContain("R$ 38,00"));
  payCommissionAction.mockResolvedValueOnce({ ok: false, error: "O valor mudou desde que você abriu (agora R$ 40,00). Confira de novo." });
  await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Confirmar pagamento" })); });
  expect(await within(sheet).findByRole("alert")).toBeTruthy();
  expect(payableAction).toHaveBeenCalledTimes(2);
});

it("sem nada a pagar: lista vazia explica", () => {
  render(<PayablesPanel items={[]} />);
  expect(screen.getByText("Nada a pagar")).toBeTruthy();
});
