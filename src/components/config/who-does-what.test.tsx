// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { setLink, accept } = vi.hoisted(() => ({
  setLink: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })), accept: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { added: 2 } })),
}));
vi.mock("@/app/(app)/config/actions", () => ({ setProfessionalServiceAction: (...a: unknown[]) => setLink(...a), acceptSuggestionsAction: (...a: unknown[]) => accept(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { WhoDoesWhat } from "./who-does-what";

afterEach(() => { cleanup(); setLink.mockClear(); accept.mockClear(); });

const ANA = "11111111-1111-4111-8111-111111111111", BIA = "22222222-2222-4222-8222-222222222222";
const CORTE = "33333333-3333-4333-8333-333333333333", UNHA = "44444444-4444-4444-8444-444444444444";
const PROS = [{ id: ANA, name: "Ana", serviceIds: [CORTE], color: null }, { id: BIA, name: "Bia", serviceIds: [], color: "ameixa" }];
const SERVICES = [{ id: CORTE, label: "Corte" }, { id: UNHA, label: "Unha" }];
const SUGG = [{ professionalId: BIA, professionalName: "Bia", serviceId: UNHA, serviceLabel: "Unha", count: 14 }];

it("matriz profissional × serviço: marcado, sugestão com as vezes, e marcar grava o vínculo", async () => {
  render(<WhoDoesWhat pros={PROS} services={SERVICES} suggestions={SUGG} />);
  expect((screen.getByRole("checkbox", { name: "Ana faz Corte" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Bia faz Unha (sugestão: fez 14 vezes em 12 meses)" }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Ana faz Unha" }));
  await waitFor(() => expect(setLink).toHaveBeenCalledWith(ANA, UNHA, true));
  fireEvent.click(screen.getByRole("checkbox", { name: "Ana faz Corte" }));
  await waitFor(() => expect(setLink).toHaveBeenCalledWith(ANA, CORTE, false));
});

it("'Aceitar todas as sugestões' grava todas de uma vez", async () => {
  render(<WhoDoesWhat pros={PROS} services={SERVICES} suggestions={SUGG} />);
  fireEvent.click(screen.getByRole("button", { name: "Aceitar todas as sugestões (1)" }));
  await waitFor(() => expect(accept).toHaveBeenCalledWith({}));
});
