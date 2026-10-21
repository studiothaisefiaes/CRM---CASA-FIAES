// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PayoutRow } from "@/lib/payouts";

const undoPayoutAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true }));
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({ undoPayoutAction: (...a: unknown[]) => undoPayoutAction(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { PayoutsList, UndoPayout } from "./payouts-list";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ROW: PayoutRow = { id: "r1", number: 7, professionalId: "p1", professionalName: "Ana", fromDay: "2026-09-01", untilDay: "2026-09-30", netCents: 4300, carriedCents: 0,
  paidAt: "2026-10-01T13:00:00.000Z", paidByName: "Thaíse", cancelledAt: null, cancelReason: null };

it("Pagas: cada recibo com número, profissional, período e valor; abre o recibo e desfaz com motivo", async () => {
  render(<PayoutsList rows={[ROW, { ...ROW, id: "r0", number: 6, cancelledAt: "2026-10-02T10:00:00.000Z", cancelReason: "errado" }]} />);
  const [vivo, desfeito] = screen.getAllByRole("listitem");
  expect((vivo.textContent ?? "").replace(/\s/g, " ")).toContain("Recibo nº 7 · Ana");
  expect(within(vivo).getByRole("link", { name: "Abrir recibo" }).getAttribute("href")).toBe("/caixa/comissao/recibo/r1");
  expect(within(desfeito).getByText(/Desfeito/)).toBeTruthy();
  expect(within(desfeito).queryByRole("button", { name: "Desfazer" })).toBeNull();
  fireEvent.click(within(vivo).getByRole("button", { name: "Desfazer" }));
  await act(async () => { fireEvent.click(within(vivo).getByRole("button", { name: "Confirmar desfazer" })); });
  expect(undoPayoutAction).not.toHaveBeenCalled();
  expect(within(vivo).getByRole("alert").textContent).toBe("Escreva o motivo.");
  fireEvent.change(within(vivo).getByLabelText("Motivo"), { target: { value: "pago errado" } });
  await act(async () => { fireEvent.click(within(vivo).getByRole("button", { name: "Confirmar desfazer" })); });
  expect(undoPayoutAction).toHaveBeenCalledWith("r1", { reason: "pago errado" });
});

it("UndoPayout sozinho (página do recibo) também pede o motivo", async () => {
  render(<UndoPayout id="r9" />);
  fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar desfazer" })); });
  expect(undoPayoutAction).toHaveBeenCalledWith("r9", { reason: "x" });
});

it("sem recibos: vazio explica", () => {
  render(<PayoutsList rows={[]} />);
  expect(screen.getByText("Nenhum recibo ainda")).toBeTruthy();
});
