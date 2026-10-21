// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const reopenCashAction = vi.fn();
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => ({ reopenCashAction: (...a: unknown[]) => (reopenCashAction as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ReopenCashButton } from "./reopen-cash-button";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("reabrir o caixa (QA r58, I-2): pede confirmação e motivo; sem motivo, o botão diz o que falta; cancelar não reabre", async () => {
  reopenCashAction.mockResolvedValue({ ok: true });
  render(<ReopenCashButton id="c1" ownerName="Rita" />);
  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  expect(reopenCashAction).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Reabrir o caixa de Rita?" })).toBeTruthy();
  const confirm = screen.getByRole("button", { name: "Reabrir o caixa" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(document.getElementById(confirm.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Para reabrir, escreva o motivo.");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(reopenCashAction).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  fireEvent.change(screen.getByLabelText("Motivo da reabertura (obrigatório)"), { target: { value: "estorno de Pix em dobro" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reabrir o caixa" })); });
  expect(reopenCashAction).toHaveBeenCalledWith("c1", { reason: "estorno de Pix em dobro" });
  expect(toast).toHaveBeenCalledWith("Caixa reaberto", "ok");
});

it("um 'Reabrir' por seção (r68 #15): escolhe o caixa numa lista dentro da confirmação", async () => {
  reopenCashAction.mockResolvedValue({ ok: true });
  render(<ReopenCashButton choices={[{ id: "c1", label: "18/10 · Rita", ownerName: "Rita" }, { id: "c2", label: "17/10 · Ana", ownerName: "Ana" }]} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Reabrir um caixa" }));
  expect(screen.getByRole("dialog", { name: "Reabrir um caixa?" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Qual caixa"), { target: { value: "c2" } });
  fireEvent.change(screen.getByLabelText("Motivo da reabertura (obrigatório)"), { target: { value: "troco errado" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reabrir o caixa" })); });
  expect(reopenCashAction).toHaveBeenCalledWith("c2", { reason: "troco errado" });
});
