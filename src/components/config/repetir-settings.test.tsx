// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async (v: unknown) => ({ ok: true as const, data: v }));
vi.mock("@/app/(app)/config/actions", () => ({ saveRepetirConfigAction: (v: unknown) => save(v) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/agenda" }));
import { RepetirSettings } from "./repetir-settings";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ui = (on = true) => render(<ToastProvider><RepetirSettings config={{ maxSemanas: 12, maxVezes: 26 }} repetirOn={on} /></ToastProvider>);

it("muda os limites (de 1 a 52 semanas, de 2 a 104 vezes); fora da faixa avisa e não salva", async () => {
  ui();
  const semanas = screen.getByLabelText("Até quantas semanas entre uma vez e outra");
  const vezes = screen.getByLabelText("Até quantas vezes");
  expect((semanas as HTMLInputElement).value).toBe("12");
  expect((vezes as HTMLInputElement).value).toBe("26");
  fireEvent.change(vezes, { target: { value: "105" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(screen.getByRole("alert").textContent).toBe("Use de 2 a 104 vezes.");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(semanas, { target: { value: "53" } });
  fireEvent.change(vezes, { target: { value: "30" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(screen.getByRole("alert").textContent).toBe("Use de 1 a 52 semanas.");
  fireEvent.change(semanas, { target: { value: "8" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(save).toHaveBeenCalledWith({ maxSemanas: 8, maxVezes: 30 });
});

it("função desligada: avisa e trava", () => {
  ui(false);
  expect(screen.getByRole("note").textContent).toMatch(/desligada em Configurações › Recursos/);
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
});
