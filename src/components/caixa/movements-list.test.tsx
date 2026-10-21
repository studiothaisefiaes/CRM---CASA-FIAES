// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const cancelMovementAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/caixa/actions", () => ({ cancelMovementAction: (...a: unknown[]) => cancelMovementAction(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { MovementsList } from "./movements-list";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const rows = [{ id: "m1", kind: "sangria" as const, valueCents: 5000, reason: "vale", at: "2026-10-15T12:00:00Z", vale: "Ana" }];

it("mostra a sangria com a profissional do vale; Cancelar pede o motivo e manda", async () => {
  render(<MovementsList rows={rows} />);
  expect(screen.getByText(/vale de Ana/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Cancelar sangria/ }));
  fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "Contei errado" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
  await waitFor(() => expect(cancelMovementAction).toHaveBeenCalledWith("m1", { reason: "Contei errado" }));
});

it("sem movimentos, nada aparece", () => {
  const { container } = render(<MovementsList rows={[]} />);
  expect(container.innerHTML).toBe("");
});
