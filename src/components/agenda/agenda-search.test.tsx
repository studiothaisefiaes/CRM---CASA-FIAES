// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const searchClientsAction = vi.fn(async () => ({ ok: true as const, data: [{ id: "c1", name: "Paula Souza", phone: null, lastVisit: null, ignored: false }] }));
const clientAgendaAction = vi.fn(async () => ({ ok: true as const, data: {
  futuros: [{ appointmentId: "a1", day: "2026-10-20", startsAt: "2026-10-20T13:00:00.000Z", serviceLabel: "Corte", professionalName: "Ana", status: "agendado", origin: "crm" }],
  passados: [], cancelados: [],
} }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  searchClientsAction: (...a: unknown[]) => (searchClientsAction as (...x: unknown[]) => unknown)(...a),
  clientAgendaAction: (...a: unknown[]) => (clientAgendaAction as (...x: unknown[]) => unknown)(...a),
}));
import { AgendaSearch } from "./agenda-search";

afterEach(cleanup);

it("busca a cliente e mostra os horários dela; tocar leva ao dia com o horário destacado", async () => {
  render(<AgendaSearch />);
  fireEvent.change(screen.getByLabelText("Buscar cliente na Agenda"), { target: { value: "pau" } });
  const pick = await screen.findByRole("button", { name: "Paula Souza" });
  await act(async () => { fireEvent.click(pick); });
  expect(screen.getByRole("region", { name: "Horários de Paula Souza" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Corte com Ana/ }).getAttribute("href")).toBe("/agenda?d=2026-10-20&destaque=a1");
});
