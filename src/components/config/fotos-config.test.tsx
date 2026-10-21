// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { maxMb: 8 } }));
vi.mock("@/app/(app)/config/fichas/actions", () => ({ savePhotoConfigAction: (...a: unknown[]) => save(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/fichas" }));
import { FotosConfig } from "./fotos-config";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ui = (on = true) => render(<ToastProvider><FotosConfig maxMb={5} fotosOn={on} /></ToastProvider>);

it("mostra o tamanho atual e salva o novo", async () => {
  ui();
  const input = screen.getByLabelText("Tamanho máximo da foto (MB)") as HTMLInputElement;
  expect(input.value).toBe("5");
  fireEvent.change(input, { target: { value: "8" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(save).toHaveBeenCalledWith({ maxMb: 8 });
});
it("fora de 1 a 20 não envia; função desligada trava o campo", async () => {
  ui();
  fireEvent.change(screen.getByLabelText("Tamanho máximo da foto (MB)"), { target: { value: "21" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("1 a 20");
  cleanup();
  ui(false);
  expect((screen.getByLabelText("Tamanho máximo da foto (MB)") as HTMLInputElement).disabled).toBe(true);
});
