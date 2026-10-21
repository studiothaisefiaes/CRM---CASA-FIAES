// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save } = vi.hoisted(() => ({ save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })) }));
vi.mock("@/app/(app)/config/actions", () => ({ saveAutoMessageAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AutoMessageEditor } from "./auto-messages";

afterEach(cleanup);

it("ligar pede a confirmação de envio real; cancelar não liga nada", async () => {
  render(<AutoMessageEditor kind="ausencia" initial={{ enabled: false, text: "Oi, {nome}!" }} />);
  expect(screen.getByLabelText("Prévia de Ausência").textContent).toBe("Oi, Maria!");
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Ausência" }));
  expect(screen.getByText("Isto vai enviar mensagens reais para clientes.", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Ausência" }));
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("ausencia", { enabled: true, text: "Oi, {nome}!" }));
});
