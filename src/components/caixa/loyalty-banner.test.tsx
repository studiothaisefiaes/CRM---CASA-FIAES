// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const redeem = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { itemId: "i9" } })));
vi.mock("@/app/(app)/caixa/actions", () => ({ redeemLoyaltyAction: (...a: unknown[]) => redeem(...a) }));
import { LoyaltyBanner } from "./loyalty-banner";
import type { LoyaltyStatusView } from "@/lib/loyalty";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const FIN = "f1111111-1111-4111-8111-111111111111", RIT = "f2222222-2222-4222-8222-222222222222", PROG = "a1111111-1111-4111-8111-111111111111";
const SERVICES = [{ id: FIN, label: "Finalização simples" }, { id: RIT, label: "Ritual de tratamento" }];
const PROS = [{ id: "p1", name: "Ana", active: true }, { id: "p2", name: "Bia", active: true }, { id: "p3", name: "Antiga", active: false }];
const fiel = (over: Partial<LoyaltyStatusView> = {}): LoyaltyStatusView => ({ programId: PROG, name: "Fiel da Fiaes", kind: "contagem", goal: 12, balance: 12, ready: true, rewardServiceIds: [FIN, RIT], ...over });
const ui = (o: { programs?: LoyaltyStatusView[]; items?: React.ComponentProps<typeof LoyaltyBanner>["items"]; canRedeem?: boolean } = {}) => {
  const done = vi.fn();
  render(<LoyaltyBanner comandaId="c1" programs={o.programs ?? [fiel()]} items={o.items ?? []} services={SERVICES} professionals={PROS} canRedeem={o.canRedeem ?? true} onDone={done} />);
  return done;
};

it("comanda com saldo completo mostra 'Fiel da Fiaes: 12 de 12 · Usar o prêmio'; o resgate pergunta UMA coisa por tela (serviço → profissional → confirmar)", async () => {
  const done = ui();
  expect(screen.getByText("Fiel da Fiaes:")).toBeTruthy();
  expect(screen.getByText("12 de 12")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Usar o prêmio" }));

  // 1ª tela: só o serviço
  expect(screen.getByRole("dialog", { name: "Qual serviço é o prêmio?" })).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Finalização simples/ }));

  // 2ª tela: só a profissional (a que saiu do ar não aparece)
  expect(screen.getByRole("dialog", { name: "Com quem?" })).toBeTruthy();
  expect(screen.queryByText("Finalização simples")).toBeNull();
  expect(screen.queryByRole("radio", { name: "Antiga" })).toBeNull();
  expect((screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Bia" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

  // 3ª tela: confirmar
  const d = screen.getByRole("dialog", { name: "Usar o prêmio?" });
  expect(within(d).getByText(/Finalização simples com Bia/)).toBeTruthy();
  await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Usar o prêmio" })); });
  expect(redeem).toHaveBeenCalledWith("c1", PROG, { serviceId: FIN, professionalId: "p2" });
  expect(done).toHaveBeenCalledTimes(1);
});

it("serviço do prêmio que já está na comanda: usa o item (sem perguntar a profissional)", async () => {
  ui({ items: [{ id: "i1", kind: "servico", label: "Finalização simples", serviceId: FIN, discountCents: 0, professionalName: "Ana" }] });
  fireEvent.click(screen.getByRole("button", { name: "Usar o prêmio" }));
  fireEvent.click(screen.getByRole("button", { name: /Finalização simples/ }));
  expect(screen.getByRole("dialog", { name: "Usar o prêmio?" })).toBeTruthy();
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Usar o prêmio" })); });
  expect(redeem).toHaveBeenCalledWith("c1", PROG, { itemId: "i1" });
});

it("recusa do servidor aparece na própria tela e não fecha", async () => {
  redeem.mockResolvedValueOnce({ ok: false, error: "Faltam 2 serviços para o prêmio." } as never);
  ui({ items: [{ id: "i1", kind: "servico", label: "Finalização simples", serviceId: FIN, discountCents: 0, professionalName: null }] });
  fireEvent.click(screen.getByRole("button", { name: "Usar o prêmio" }));
  fireEvent.click(screen.getByRole("button", { name: /Finalização simples/ }));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Usar o prêmio" })); });
  expect(screen.getByRole("alert").textContent).toBe("Faltam 2 serviços para o prêmio.");
});

it("sem fidelidade.resgatar o botão não aparece; sem pontos o aviso nem aparece; saldo parcial mostra quanto falta", () => {
  ui({ canRedeem: false });
  expect(screen.queryByRole("button", { name: "Usar o prêmio" })).toBeNull();
  cleanup();
  ui({ programs: [fiel({ balance: 0, ready: false })] });
  expect(screen.queryByLabelText("Fidelidade")).toBeNull();
  cleanup();
  ui({ programs: [fiel({ balance: 9, ready: false })] });
  expect(screen.getByText("9 de 12")).toBeTruthy();
  expect(screen.getByText(/Faltam 3 serviços para o prêmio\./)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Usar o prêmio" })).toBeNull();
});
