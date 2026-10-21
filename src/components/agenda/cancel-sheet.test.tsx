// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgendaItem } from "@/server/queries/agenda";

const cancelAction = vi.fn(async () => ({ ok: true as const, data: { cancelled: 2, day: "2026-10-16", waitlist: 1 } }));
vi.mock("@/app/(app)/agenda/actions", () => ({ cancelAction: (...a: unknown[]) => (cancelAction as (...x: unknown[]) => unknown)(...a) }));
import { CancelSheet } from "./cancel-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); cancelAction.mockClear(); });

const ITEM = {
  key: "ag:1", source: "agendamento", dealId: "d1", appointmentId: "11111111-1111-4111-8111-111111111111", visitId: "v1", contactId: "c1", name: "Paula Souza", phone: null,
  hasAvatar: false, scheduledAt: "2026-10-16T13:00:00.000Z", durationMin: 60, durationEstimated: false, noTime: false, service: "Corte", serviceId: "s1", ownerName: null,
  professionalId: "p1", professionalName: "Ana", stageName: null, status: "agendado", dbStatus: "agendado", origin: "crm", notes: null, bookedBy: null, paid: false,
  firstVisit: false, anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null, professionalColor: null,
} satisfies AgendaItem;

it("motivo obrigatório; 'Outro' pede o texto; visita com 2 serviços pergunta o que cancelar", async () => {
  const onDone = vi.fn();
  render(<CancelSheet open onClose={() => {}} item={ITEM} visitCount={2} agendaMode="so_crm" onDone={onDone} />);
  const dlg = screen.getByRole("dialog", { name: "Cancelar horário" });
  const confirm = () => within(dlg).getByRole("button", { name: "Cancelar horário" });
  await act(async () => { fireEvent.click(confirm()); });
  expect(within(dlg).getByRole("alert").textContent).toBe("Escolha o motivo.");
  fireEvent.click(within(dlg).getByRole("radio", { name: "Outro" }));
  await act(async () => { fireEvent.click(confirm()); });
  expect(within(dlg).getByRole("alert").textContent).toBe("Escreva o motivo.");
  fireEvent.change(within(dlg).getByLabelText("Qual o motivo?"), { target: { value: "viagem" } });
  fireEvent.click(within(dlg).getByRole("radio", { name: "A visita toda" }));
  await act(async () => { fireEvent.click(confirm()); });
  expect(cancelAction).toHaveBeenCalledWith({ appointmentId: ITEM.appointmentId, scope: "visita", reason: "outro", note: "viagem" });
  expect(onDone).toHaveBeenCalledWith({ cancelled: 2, waitlist: 1 });
});

it("'Avisar a cliente' copia o texto pronto (nada é enviado); fora do modo só CRM, lembra de cancelar também no Avec", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<CancelSheet open onClose={() => {}} item={ITEM} visitCount={1} agendaMode="consulta" onDone={() => {}} />);
  expect(screen.queryByRole("radio", { name: "A visita toda" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Avisar a cliente" })); });
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("foi cancelado"));
  expect(screen.getByText("Texto copiado: cole na conversa da cliente.")).toBeTruthy();
  expect(screen.getByRole("note").textContent).toBe("Enquanto o Avec estiver ligado, cancele também lá.");
});

it("horário com série pergunta 'Só este / Este e os próximos' e manda scope 'serie'", async () => {
  render(<CancelSheet open onClose={() => {}} item={{ ...ITEM, series: { index: 2, total: 4 } }} visitCount={1} agendaMode="so_crm" onDone={() => {}} />);
  const dlg = screen.getByRole("dialog", { name: "Cancelar horário" });
  expect(within(dlg).getByRole("radio", { name: "Só este" })).toBeTruthy();
  expect(within(dlg).queryByRole("radio", { name: "A visita toda" })).toBeNull();
  fireEvent.click(within(dlg).getByRole("radio", { name: "A cliente desmarcou" }));
  fireEvent.click(within(dlg).getByRole("radio", { name: "Este e os próximos" }));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar horário" })); });
  expect(cancelAction).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: ITEM.appointmentId, scope: "serie" }));
});

it("série numa visita com 2 serviços: as três escolhas", () => {
  render(<CancelSheet open onClose={() => {}} item={{ ...ITEM, series: { index: 1, total: 3 } }} visitCount={2} agendaMode="so_crm" onDone={() => {}} />);
  for (const n of ["Só este serviço", "A visita toda", "Este e os próximos"]) expect(screen.getByRole("radio", { name: n })).toBeTruthy();
});
