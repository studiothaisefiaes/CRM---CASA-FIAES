// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/app/(app)/contatos/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/contatos/x", useSearchParams: () => new URLSearchParams() }));
import { LoyaltyCard } from "./blocks";
import type { LoyaltyView } from "@/server/queries/loyalty-view";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => cleanup());

const VIEW: LoyaltyView = {
  programs: [
    { programId: "a", name: "Fiel da Fiaes", kind: "contagem", goal: 12, balance: 9, ready: false, rewardServiceIds: [] },
    { programId: "b", name: "Aniversário", kind: "aniversario", goal: null, balance: 1, ready: true, rewardServiceIds: [] },
  ],
  history: [
    { id: "h2", at: "2026-10-05T12:00:00Z", programName: "Fiel da Fiaes", delta: 1, reason: "servico", note: null },
    { id: "h1", at: "2026-10-01T12:00:00Z", programName: "Fiel da Fiaes", delta: 8, reason: "saldo_avec", note: "Saldo trazido do Avec" },
  ],
};

it("cartão pequeno no Resumo ('Fiel da Fiaes 9 de 12') que abre o painel com todos os programas e o histórico", () => {
  render(<LoyaltyCard view={VIEW} />);
  expect(screen.getByText("Fiel da Fiaes 9 de 12")).toBeTruthy();
  expect(screen.getByText("Aniversário prêmio disponível")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Fidelidade" }));
  const d = within(screen.getByRole("dialog", { name: "Fidelidade" }));
  expect(d.getByText("Faltam 3 serviços para o prêmio.")).toBeTruthy();
  expect(d.getAllByRole("listitem").map((li) => li.textContent).filter((t) => /Serviço|Saldo/.test(t ?? ""))).toEqual([
    expect.stringContaining("Serviço · Fiel da Fiaes"), expect.stringContaining("Saldo trazido do Avec · Fiel da Fiaes"),
  ]);
  expect(d.getByText("+8")).toBeTruthy();
});

it("sem programa em uso o cartão avisa", () => {
  render(<LoyaltyCard view={{ programs: [], history: [] }} />);
  expect(screen.getByText("Nenhum programa em uso.")).toBeTruthy();
});
