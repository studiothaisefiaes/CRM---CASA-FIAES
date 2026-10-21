// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const waitlistAction = vi.fn(async () => ({ ok: true as const, data: { id: "w1" } }));
const searchClientsAction = vi.fn(async () => ({ ok: true as const, data: [{ id: "c1", name: "Lia Souza", phone: null, lastVisit: null, ignored: false }] }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  peopleOnNumberAction: vi.fn(async () => ({ ok: true, data: [] })),
  waitlistAction: (...a: unknown[]) => (waitlistAction as (...x: unknown[]) => unknown)(...a),
  searchClientsAction: (...a: unknown[]) => (searchClientsAction as (...x: unknown[]) => unknown)(...a),
}));
import { WaitlistSheet } from "./waitlist-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

it("pede a cliente; manda serviço, profissional (ou qualquer uma), dia e período", async () => {
  const onDone = vi.fn();
  render(<WaitlistSheet open onClose={() => {}} today="2026-10-16" onDone={onDone}
    services={[{ id: "s1", label: "Corte", durationMin: 60 }]} professionals={[{ id: "p1", name: "Ana", active: true, serviceIds: ["s1"] }]} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pôr na lista de espera" })); });
  expect(screen.getByRole("alert").textContent).toBe("Escolha a cliente.");
  fireEvent.change(screen.getByLabelText("Buscar cliente por nome ou telefone"), { target: { value: "lia" } });
  fireEvent.click(await screen.findByRole("button", { name: /Lia Souza/ }));
  fireEvent.change(screen.getByLabelText("Serviço desejado"), { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText("Dia desejado"), { target: { value: "2026-10-17" } });
  fireEvent.click(screen.getByRole("radio", { name: "Tarde" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pôr na lista de espera" })); });
  expect(waitlistAction).toHaveBeenCalledWith({ client: { contactId: "c1" }, serviceId: "s1", professionalId: null, day: "2026-10-17", window: "tarde", notes: null });
  expect(onDone).toHaveBeenCalled();
});
