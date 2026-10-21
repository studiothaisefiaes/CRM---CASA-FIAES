// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const addAdjustmentAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const saveAdjustmentRuleAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const cancelAdjustmentAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({
  addAdjustmentAction: (...a: unknown[]) => addAdjustmentAction(...a), saveAdjustmentRuleAction: (...a: unknown[]) => saveAdjustmentRuleAction(...a),
  cancelAdjustmentAction: (...a: unknown[]) => cancelAdjustmentAction(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AdjustmentsPanel } from "./adjustments-panel";
import type { AdjustmentRow } from "@/lib/adjustments";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const row = (o: Partial<AdjustmentRow> = {}): AdjustmentRow => ({ id: "a1", professionalId: "p1", professionalName: "Ana", kind: "vale" as const, valueCents: 5000, day: "2026-10-10", note: "Adiantamento", ruleId: null, fromSangria: false, paid: false, cancelledAt: null, createdByName: "Cati", ...o });
const ROWS = [row(), row({ id: "a2", kind: "bonus", valueCents: 10000, note: "Meta", ruleId: "r1" }), row({ id: "a3", kind: "desconto", valueCents: 2000, note: "Aluguel" }),
  row({ id: "a4", valueCents: 999, cancelledAt: "2026-10-11T10:00:00Z" })];
const PROS = [{ id: "p1", name: "Ana" }, { id: "p2", name: "Bia" }];

it("mostra os lançamentos do período com Vale, Bônus e Desconto na comissão, o total de cada um (sem os cancelados) e o que veio da sangria", () => {
  render(<AdjustmentsPanel rows={[...ROWS, row({ id: "a5", fromSangria: true, note: "vale" })]} rules={[]} professionals={PROS} from="2026-10-01" to="2026-10-31" today="2026-10-15" />);
  expect(screen.getByTestId("total-vale").textContent).toMatch(/R\$\s*100\b/); // 50 + 50 da sangria; o cancelado de 9,99 fica de fora
  expect(screen.getByTestId("total-bonus").textContent).toMatch(/R\$\s*100\b/);
  expect(screen.getByTestId("total-desconto").textContent).toMatch(/R\$\s*20\b/);
  expect(screen.getAllByText("Desconto na comissão").length).toBeGreaterThan(0);
  expect(screen.getByText("Cancelado")).toBeTruthy();
  expect(screen.getByText("Pela sangria")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancelar lançamento de Aluguel" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancelar lançamento de vale" })).toBeNull(); // da sangria: cancela-se no caixa
});

it("lançar avulso manda profissional, tipo, valor, data e motivo; sem motivo avisa", async () => {
  render(<AdjustmentsPanel rows={[]} rules={[]} professionals={PROS} from="2026-10-01" to="2026-10-31" today="2026-10-15" />);
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p2" } });
  fireEvent.click(screen.getByRole("radio", { name: "Bônus" }));
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "100,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
  expect(await screen.findByText("Escreva o motivo.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Meta" } });
  fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
  await waitFor(() => expect(addAdjustmentAction).toHaveBeenCalledWith({ professionalId: "p2", kind: "bonus", valueCents: 10000, day: "2026-10-15", note: "Meta" }));
});

it("'Todo mês' pede o dia (1 a 28) e salva a regra", async () => {
  render(<AdjustmentsPanel rows={[]} rules={[]} professionals={PROS} from="2026-10-01" to="2026-10-31" today="2026-10-15" />);
  fireEvent.click(screen.getByLabelText("Todo mês"));
  const dia = screen.getByLabelText("No dia") as HTMLSelectElement;
  expect(dia.options).toHaveLength(28);
  fireEvent.change(dia, { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Aluguel" } });
  fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
  await waitFor(() => expect(saveAdjustmentRuleAction).toHaveBeenCalledWith(expect.objectContaining({ professionalId: "p1", kind: "vale", valueCents: 5000, dayOfMonth: 5, startsOn: "2026-10-15", note: "Aluguel", active: true })));
  expect(addAdjustmentAction).not.toHaveBeenCalled();
});

it("lista os 'todo mês' e deixa desligar", async () => {
  const rule = { id: "r1", professionalId: "p1", professionalName: "Ana", kind: "bonus" as const, valueCents: 10000, dayOfMonth: 5, startsOn: "2026-08-01", endsOn: null, note: "Meta", active: true };
  render(<AdjustmentsPanel rows={[]} rules={[rule]} professionals={PROS} from="2026-10-01" to="2026-10-31" today="2026-10-15" />);
  expect(screen.getByText(/Todo dia 5/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Desligar Meta" }));
  await waitFor(() => expect(saveAdjustmentRuleAction).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", active: false })));
});
