// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { find } = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/app/(app)/agenda/actions", () => ({ findFreeSlotsAction: (...a: unknown[]) => find(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { SlotFinder } from "./slot-finder";

const writeText = vi.fn(async (_t: string) => {});
beforeEach(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true }); });
afterEach(() => { cleanup(); find.mockReset(); writeText.mockClear(); });

const CORTE = "33333333-3333-4333-8333-333333333333", MECHAS = "44444444-4444-4444-8444-444444444444";
const SERVICES = [{ id: CORTE, label: "Corte" }, { id: MECHAS, label: "Mechas" }];
const PROS = [{ id: "a", name: "Ana", serviceIds: [CORTE] }, { id: "b", name: "Bia", serviceIds: [CORTE] }];

it("mostra os 3 próximos de cada uma e copia as opções escolhidas (de saída, as 3 mais cedo)", async () => {
  find.mockResolvedValue({ ok: true, data: { ok: true, stepMin: 30, service: { id: CORTE, label: "Corte", durationMin: 60, bufferMin: 0 }, pros: [
    { id: "a", name: "Ana", color: null, slots: [{ day: "2026-10-15", start: 600, warnings: [] }, { day: "2026-10-15", start: 900, warnings: [] }, { day: "2026-10-16", start: 540, warnings: ["Ana tem outra cliente às 08:00 sem duração informada: confira antes"] }] },
    { id: "b", name: "Bia", color: "ameixa", slots: [{ day: "2026-10-15", start: 870, warnings: [] }] },
  ] } });
  render(<SlotFinder open onClose={() => {}} services={SERVICES} pros={PROS} />);
  fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: CORTE } });
  fireEvent.click(screen.getByRole("button", { name: "Procurar" }));
  await waitFor(() => expect(find).toHaveBeenCalledWith({ serviceId: CORTE, professionalId: null }));
  expect(await screen.findByRole("button", { name: "quinta, 15/10 · 10:00 com Ana", pressed: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "sexta, 16/10 · 09:00 com Ana", pressed: false })).toBeTruthy();
  expect(screen.getByText("Ana tem outra cliente às 08:00 sem duração informada: confira antes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copiar opções" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Tenho quinta, 15/10, às 10h com a Ana ou às 14h30 com a Bia ou às 15h com a Ana"));
  fireEvent.click(screen.getByRole("button", { name: "quinta, 15/10 · 15:00 com Ana" })); // tira
  fireEvent.click(screen.getByRole("button", { name: "Copiar opções" }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Tenho quinta, 15/10, às 10h com a Ana ou às 14h30 com a Bia"));
});

it("serviço sem duração: explica e leva direto ao serviço; ninguém faz: leva a Profissionais", async () => {
  find.mockResolvedValueOnce({ ok: true, data: { ok: false, reason: "sem_duracao", service: { id: MECHAS, label: "Mechas" } } });
  render(<SlotFinder open onClose={() => {}} services={SERVICES} pros={PROS} />);
  fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: MECHAS } });
  fireEvent.click(screen.getByRole("button", { name: "Procurar" }));
  expect(await screen.findByText("Mechas não tem duração cadastrada. Preencha em Configurações › Serviços para ver horários livres.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Preencher a duração" }).getAttribute("href")).toBe(`/servicos?servico=${MECHAS}`);
  find.mockResolvedValueOnce({ ok: true, data: { ok: false, reason: "ninguem_faz", service: { id: MECHAS, label: "Mechas" } } });
  fireEvent.click(screen.getByRole("button", { name: "Procurar" }));
  expect(await screen.findByText("Ninguém está marcado para fazer Mechas. Marque em Configurações › Profissionais.")).toBeTruthy();
});
