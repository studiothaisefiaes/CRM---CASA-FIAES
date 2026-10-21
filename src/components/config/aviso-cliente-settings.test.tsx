// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/config/aviso-cliente/actions", () => ({ saveClientAlertAction: (...a: unknown[]) => save(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/aviso-cliente" }));
import { AvisoClienteSettings } from "./aviso-cliente-settings";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const CFG = { noHorario: true, naComanda: true, textoSemUsoImagem: "Sem foto, por favor" };
const ui = (on = true) => render(<ToastProvider><AvisoClienteSettings config={CFG} avisoOn={on} /></ToastProvider>);

it("liga e desliga no horário e na comanda; muda o texto; 'Usar o texto sugerido' volta ao de fábrica", async () => {
  ui();
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Saltar ao abrir o horário" })); });
  expect(save).toHaveBeenCalledWith({ noHorario: false });
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Saltar ao abrir a comanda" })); });
  expect(save).toHaveBeenCalledWith({ naComanda: false });
  const campo = screen.getByLabelText("Texto de quem não autorizou uso de imagem");
  fireEvent.change(campo, { target: { value: "Nada de foto" } });
  await act(async () => { fireEvent.blur(campo); });
  expect(save).toHaveBeenCalledWith({ textoSemUsoImagem: "Nada de foto" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" })); });
  expect(save).toHaveBeenCalledWith({ textoSemUsoImagem: "" });
});
it("função desligada: avisa e trava", () => {
  ui(false);
  expect(screen.getByRole("note")).toBeTruthy();
  expect((screen.getByRole("switch", { name: "Saltar ao abrir o horário" }) as HTMLButtonElement).disabled).toBe(true);
});
