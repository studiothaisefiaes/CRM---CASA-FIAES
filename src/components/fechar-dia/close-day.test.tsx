// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { money } from "@/lib/format";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/caixa/fechar-dia", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/agenda/actions", () => ({ markManyAction: vi.fn(), undoManyAction: vi.fn() }));
vi.mock("@/app/(app)/caixa/actions", () => ({ closeCashAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
import type { CashStep, NoOutcomeRow, OpenComandaRow } from "@/server/queries/fechar-dia";
import { CloseDay } from "./close-day";
import { firstPendingStep, pendingSummary } from "@/lib/fechar-dia-steps";

afterEach(cleanup);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
const rows: NoOutcomeRow[] = [
  { id: "a1", startsAt: "2026-10-15T13:00:00.000Z", endsAt: "2026-10-15T14:00:00.000Z", clientName: "Rita Lima", contactId: null, professional: "Ana", service: "Corte", status: "agendado", avec: { status: "compareceu", why: "comanda" }, suggest: "compareceu" },
  { id: "a2", startsAt: "2026-10-15T14:00:00.000Z", endsAt: "2026-10-15T15:00:00.000Z", clientName: "Paula Souza", contactId: null, professional: null, service: "Escova", status: "confirmado", avec: { status: "aberto", why: "status" }, suggest: null },
];
const comandas: OpenComandaRow[] = [{ id: "c1", day: "2026-10-15", number: 4, clientName: "Bia", itens: 2, totalCents: 21000, paidCents: 0 }];
const open: CashStep = { mode: "crm", open: { id: "s1", openedByName: "Cati", openedAt: "2026-10-15T12:00:00.000Z", openComandas: 1 }, team: [] };
const rita = { id: "s2", personId: "u2", personName: "Rita", day: "2026-10-15", status: "aberto" as const, openedAt: "2026-10-15T11:30:00.000Z", closedAt: null, openingCents: 10000,
  received: { pix: 0, credito: 0, debito: 0, dinheiro: 0, cortesia: 0, credito_cliente: 0, outra: 0 }, expectedCash: 10000, differenceCents: null, approvedByName: null, closedByName: null,
  expected: { dinheiro: 10000, pix: 0, credito: 0, debito: 0, outra: 0 }, byBrand: [], openComandas: 0, differences: [] };

describe("Fechar o dia", () => {
  it("passos com contagem; passo 1 com a sugestão do Avec, seleção e lote", () => {
    render(<CloseDay today="2026-10-15" noOutcome={rows} comandas={comandas} cash={open} step={1} />);
    expect(screen.getByRole("link", { name: /1\s*Horários sem desfecho\s*2/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /2\s*Comandas abertas\s*1/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /3\s*Fechar o caixa/ })).toBeTruthy();
    expect(screen.getByText("Rita Lima")).toBeTruthy();
    expect(screen.getByText("Avec: veio (tem comanda)")).toBeTruthy();
    expect(screen.getByText("Avec: sem desfecho")).toBeTruthy();
    const veio = screen.getByRole("button", { name: "Veio" }) as HTMLButtonElement;
    expect(veio.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar as que o Avec diz que vieram (1)" }));
    expect(veio.disabled).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Rita Lima, Corte" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Paula Souza, Escova" }) as HTMLInputElement).checked).toBe(false);
  });

  it("passo 2: a comanda aberta com o total", () => {
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={comandas} cash={open} step={2} />);
    expect(screen.getByText("Comanda 4 · Bia")).toBeTruthy();
    expect(screen.getByText(money(21000).replace(/\s/g, " "))).toBeTruthy();
  });

  it("passo 3 com o caixa no Avec: só o aviso", () => {
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={[]} cash={{ mode: "avec" }} step={3} />);
    expect(screen.getByText("O caixa ainda é no Avec.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fechar caixa" })).toBeNull();
  });

  it("passo 3 com o caixa aberto: quem abriu, sem o esperado (contagem cega) e o botão Fechar meu caixa; sem caixa aberto, avisa", () => {
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={comandas} cash={open} step={3} />);
    expect(screen.getByText(/Aberto por Cati/)).toBeTruthy();
    expect(screen.queryByText(/esperado/i)).toBeNull();
    expect(screen.getByText("1 comanda aberta fica para o próximo caixa.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar meu caixa" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fechar caixa" })).toBeNull();
    cleanup();
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={[]} cash={{ mode: "crm", open: null, team: [] }} step={3} />);
    expect(screen.getByText("Você não tem caixa aberto agora.")).toBeTruthy();
  });

  it("passo 3 da gestão (QA r58, I-3): os caixas abertos da equipe com quem abriu e desde quando, e fecha dali", () => {
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={[]} cash={{ mode: "crm", open: null, team: [rita] }} step={3} />);
    expect(screen.queryByText(/Nada para fechar/)).toBeNull();
    const equipe = screen.getByRole("region", { name: "Caixas abertos da equipe" });
    expect(equipe.textContent).toContain("Caixa de Rita");
    expect(equipe.textContent).toContain("aberto desde 08:30");
    expect(equipe.textContent).not.toContain("de 15/10");
    cleanup();
    // Caixa esquecido de ontem (revisão): é ele que mostra a data, não os de hoje.
    const ontem = { ...rita, id: "s0", personName: "Lia", day: "2026-10-14" };
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={[]} cash={{ mode: "crm", open: null, team: [ontem, rita] }} step={3} />);
    const lista = screen.getByRole("region", { name: "Caixas abertos da equipe" });
    expect(lista.textContent).toContain("aberto desde 08:30 de 14/10");
    expect(lista.textContent).not.toContain("de 15/10");
    fireEvent.click(screen.getByRole("button", { name: "Fechar o caixa de Rita" }));
    expect(screen.getByRole("dialog", { name: "Fechar o caixa de Rita" })).toBeTruthy();
  });

  it("passo 1 vazio: tudo com desfecho", () => {
    render(<CloseDay today="2026-10-15" noOutcome={[]} comandas={[]} cash={{ mode: "avec" }} step={1} />);
    expect(screen.getByText("Todos os horários de hoje têm desfecho.")).toBeTruthy();
  });
});

describe("r66 #17: abre no primeiro passo com pendência", () => {
  it("firstPendingStep e a linha de resumo", () => {
    expect(firstPendingStep(0, 4)).toBe(2);
    expect(firstPendingStep(3, 4)).toBe(1);
    expect(firstPendingStep(0, 0)).toBe(3);
    expect(pendingSummary(0, 4)).toBe("Falta: 4 comandas abertas.");
    expect(pendingSummary(1, 1)).toBe("Falta: 1 horário sem desfecho e 1 comanda aberta.");
    expect(pendingSummary(0, 0)).toBe("Nada pendente: pode fechar o caixa.");
  });
});

it("r68 #15: 'Próximo passo' é o botão primário (preto), não contorno", () => {
  render(<CloseDay today="2026-10-15" noOutcome={rows} comandas={comandas} cash={open} step={1} />);
  const next = screen.getByRole("link", { name: /Próximo passo/ });
  expect(next.className).toContain("bg-ink");
  expect(next.className).not.toContain("border-line-strong");
});
