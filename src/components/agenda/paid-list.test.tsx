// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { money } from "@/lib/format";

const book = vi.fn();
vi.mock("./agenda-sheets", () => ({ useAgendaSheets: () => ({ catalog: { agendaMode: "dupla", canMark: true }, book }), canBookIn: () => true }));
import { PaidList, paidFilterOf } from "./paid-list";

afterEach(() => { cleanup(); book.mockReset(); });
const HREF = { todos: "/agenda?aba=pagos", sem_horario: "/agenda?aba=pagos&f=sem_horario", vence_30: "/agenda?aba=pagos&f=vence_30", pacote: "/agenda?aba=pagos&f=pacote", credito: "/agenda?aba=pagos&f=credito" };
const ROWS = [
  { contactId: "c1", name: "Paula Souza", phone: null, nextAppointmentAt: null, soonestExpiry: "2027-03-12",
    entries: [{ kind: "pacote" as const, label: "Combo Método Fiaes · faltam 3 de 4 · vence 12/03", valueCents: 40000, paidOn: "2026-09-01", validUntil: "2027-03-12" }] },
  { contactId: "c2", name: "Rita Lima", phone: null, nextAppointmentAt: "2026-10-16T13:00:00.000Z", soonestExpiry: null,
    entries: [{ kind: "credito" as const, label: "Crédito da cliente", valueCents: 3000, paidOn: "2026-10-01", validUntil: null }] },
];

it("uma linha por cliente com o que pagou e falta usar, quanto e quando; 'Sem horário marcado' com Agendar", () => {
  render(<PaidList rows={ROWS} chip={null} chipHref={HREF} withValues today="2026-10-15" nowMs={Date.UTC(2026, 9, 15, 12)} />);
  const paula = screen.getByRole("listitem", { name: "Paula Souza" });
  expect(within(paula).getByText("Combo Método Fiaes · faltam 3 de 4 · vence 12/03")).toBeTruthy();
  expect(within(paula).getByText(`${money(40000)} · pago em 01/09`, { normalizer: (t) => t })).toBeTruthy();
  expect(within(paula).getByText("Sem horário marcado")).toBeTruthy();
  fireEvent.click(within(paula).getByRole("button", { name: "Agendar" }));
  expect(book).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-10-15", client: { contactId: "c1", name: "Paula Souza" } }));
  const rita = screen.getByRole("listitem", { name: "Rita Lima" });
  expect(within(rita).getByText(/^Próximo horário: /)).toBeTruthy();
  expect(within(rita).queryByRole("button", { name: "Agendar" })).toBeNull();
});

it("filtros por link; sem valores.ver, só 'pago em'", () => {
  render(<PaidList rows={ROWS.map((r) => ({ ...r, entries: r.entries.map((e) => ({ ...e, valueCents: null })) }))} chip="sem_horario" chipHref={HREF} withValues={false} today="2026-10-15" nowMs={Date.UTC(2026, 9, 15, 12)} />);
  const nav = screen.getByRole("navigation", { name: "Filtrar quem já pagou" });
  expect(within(nav).getByRole("link", { name: "Sem horário marcado" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByText(new RegExp(money(40000).replace("$", "\\$")))).toBeNull();
  expect(screen.getByText("pago em 01/09")).toBeTruthy();
  expect(paidFilterOf("vence_30", false)).toEqual({ venceEm30: true, withValues: false });
  expect(paidFilterOf("credito", true)).toEqual({ tipo: "credito", withValues: true });
});
