// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async () => ({ ok: true, data: { id: "n" } }));
vi.mock("@/app/(app)/servicos/actions", () => ({ savePaymentOptionAction: (...a: unknown[]) => (save as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { PaymentOptionsEditor } from "./payment-options";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("lista as formas, cria uma nova e desativa", async () => {
  render(<PaymentOptionsEditor options={[{ id: "o1", label: "Transferência", active: true }]} />);
  expect(screen.getByDisplayValue("Transferência")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nova forma"), { target: { value: "Vale da Casa" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
  expect(save).toHaveBeenCalledWith({ label: "Vale da Casa" });
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Transferência ativa" })); });
  expect(save).toHaveBeenLastCalledWith({ id: "o1", label: "Transferência", active: false });
});
