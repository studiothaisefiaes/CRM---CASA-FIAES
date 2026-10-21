// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const saveLabel = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "x" } }));
const saveTypes = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/config/marcadores/actions", () => ({ saveAppointmentLabelAction: (...a: unknown[]) => saveLabel(...a), saveVisitTypesAction: (...a: unknown[]) => saveTypes(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/marcadores" }));
import { MarcadoresSettings } from "./marcadores-settings";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const LABELS = [{ id: "l1", name: "VER OBS", color: null, active: true }, { id: "l2", name: "Antigo", color: null, active: false }];
const TYPES = [{ value: "indicacao" as const, label: "Indicada", active: true }, { value: "noiva" as const, label: "Noiva", active: true }];
const ui = (on = true) => render(<ToastProvider><MarcadoresSettings labels={LABELS} types={TYPES} marcadoresOn={on} tiposOn={on} /></ToastProvider>);

it("cria marcador, troca a cor, tira de uso e renomeia o tipo; 'Usar o texto sugerido' volta ao nome de fábrica", async () => {
  ui();
  fireEvent.change(screen.getByLabelText("Novo marcador"), { target: { value: "Bebê junto" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
  expect(saveLabel).toHaveBeenCalledWith({ name: "Bebê junto" });
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Cor 2 de VER OBS" })); });
  expect(saveLabel).toHaveBeenCalledWith({ id: "l1", name: "VER OBS", color: "#2f6b4f", active: true });
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Tirar de uso VER OBS" })); });
  expect(saveLabel).toHaveBeenCalledWith(expect.objectContaining({ id: "l1", active: false }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" })); });
  expect(saveTypes).toHaveBeenCalledWith({ indicacao: { label: "" } });
});

it("função desligada: avisa e trava tudo", () => {
  ui(false);
  expect(screen.getAllByRole("note")).toHaveLength(2);
  expect((screen.getByRole("button", { name: "Adicionar" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("switch", { name: "Tirar de uso VER OBS" }) as HTMLButtonElement).disabled).toBe(true);
});
