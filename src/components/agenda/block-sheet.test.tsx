// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { save, del } = vi.hoisted(() => ({
  save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { clientsInside: [] as unknown[] } })),
  del: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/agenda/actions", () => ({ saveBlockAction: (...a: unknown[]) => save(...a), deleteBlockAction: (...a: unknown[]) => del(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BlockSheet } from "./block-sheet";

afterEach(() => { cleanup(); save.mockClear(); del.mockClear(); });

const ANA = "11111111-1111-4111-8111-111111111111";
const PROS = [{ id: ANA, name: "Ana" }];

it("bloquear: quem, dia, das … às … e o motivo; no modo dupla lembra de fazer também no Avec", async () => {
  render(<BlockSheet open onClose={() => {}} pros={PROS} mode="dupla" day="2026-10-16" />);
  expect(screen.getByText("Enquanto o Avec estiver ligado, faça também no Avec.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Quem"), { target: { value: ANA } });
  fireEvent.change(screen.getByLabelText("Das"), { target: { value: "12:00" } });
  fireEvent.change(screen.getByLabelText("Às"), { target: { value: "13:00" } });
  fireEvent.click(screen.getByRole("radio", { name: "Almoço" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar bloqueio" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(null, {
    professionalId: ANA, startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "12:00", endTime: "13:00", weekdays: null, reason: "almoco", note: "",
  }));
});

it("dia inteiro, período e dias da semana", async () => {
  render(<BlockSheet open onClose={() => {}} pros={PROS} mode="so_crm" day="2026-10-16" />);
  fireEvent.click(screen.getByRole("switch", { name: "Dia inteiro" }));
  fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-31" } });
  fireEvent.click(screen.getByRole("button", { name: "Sábado", pressed: false }));
  fireEvent.click(screen.getByRole("radio", { name: "Curso" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar bloqueio" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(null, expect.objectContaining({
    professionalId: null, startsOn: "2026-10-16", endsOn: "2026-10-31", startTime: "00:00", endTime: "24:00", weekdays: [6], reason: "curso",
  })));
});

it("no modo consulta explica e não deixa salvar", () => {
  render(<BlockSheet open onClose={() => {}} pros={PROS} mode="consulta" day="2026-10-16" />);
  expect(screen.getByText("A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Salvar bloqueio" }) as HTMLButtonElement).disabled).toBe(true);
});

it("editar um bloqueio do Avec: lembra de apagar lá também e apaga só depois de confirmar", async () => {
  render(<BlockSheet open onClose={() => {}} pros={PROS} mode="dupla" day="2026-10-16" block={{
    id: "22222222-2222-4222-8222-222222222222", professionalId: ANA, title: "Folga", notes: null, startsOn: "2026-10-16", endsOn: "2026-10-16",
    startTime: "09:00", endTime: "18:00", weekdays: null, origin: "avec", reason: null,
  }} />);
  expect(screen.getByText("Este bloqueio veio do Avec. Enquanto o Avec estiver ligado, apague também lá.")).toBeTruthy();
  expect((screen.getByRole("radio", { name: "Folga" }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Apagar bloqueio" }));
  expect(del).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sim, apagar" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222"));
});
