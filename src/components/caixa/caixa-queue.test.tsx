// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CaixaQueue, QueueRow } from "@/server/queries/caixa";
import { money } from "@/lib/format";
vi.mock("@/app/(app)/caixa/actions", () => ({ cancelarComandaAction: vi.fn(), undoCancelarComandaAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CaixaQueueList } from "./caixa-queue";

afterEach(cleanup);
const row = (over: Partial<QueueRow>): QueueRow => ({ id: "c", number: 1, day: "2026-10-15", clientName: "Paula", totalCents: 12000, paidCents: 0, remainingCents: 12000,
  since: "2026-10-15T14:00:00.000Z", closedAt: null, closedByName: null, services: [{ label: "Corte", professionalName: "Ana", status: "compareceu" }], ...over });
const Q: CaixaQueue = {
  aReceber: [row({ id: "a", number: 3, clientName: "Rosa", paidCents: 2000, remainingCents: 10000 }), row({ id: "b", number: 4, clientName: "Paula" })],
  emAtendimento: [row({ id: "e", number: 5, clientName: "Rita", services: [{ label: "Hidratação", professionalName: "Bia", status: "em_atendimento" }] })],
  pagasHoje: [row({ id: "p", number: 2, clientName: "Lia", paidCents: 12000, remainingCents: 0, closedAt: "2026-10-15T15:00:00.000Z", closedByName: "Cati" })],
};

it("três listas com contagem; A receber mostra o saldo; tocar escolhe a comanda", () => {
  const onPick = vi.fn();
  render(<CaixaQueueList queue={Q} selectedId="b" onPick={onPick} now={new Date("2026-10-15T15:00:00.000Z")} />);
  const receber = screen.getByRole("region", { name: "A receber" });
  expect(within(receber).getByRole("heading").textContent).toBe("A receber2");
  expect(within(receber).getByText(`falta ${money(10000)}`, { normalizer: (t) => t })).toBeTruthy();
  expect(within(receber).getAllByText("pronta há 1h")).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Em atendimento" }).textContent).toContain("Hidratação · Bia");
  expect(screen.getByRole("region", { name: "Pagas hoje" }).textContent).toContain("Lia");
  expect(screen.getByRole("button", { name: /Comanda 4 · Paula/ }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Comanda 3 · Rosa/ }));
  expect(onPick).toHaveBeenCalledWith("a");
});

it("contagem cega (QA r58, I-1): a paga sem valor (o servidor manda null) não mostra R$", () => {
  const cega: CaixaQueue = { ...Q, pagasHoje: [row({ id: "p", number: 2, clientName: "Lia", totalCents: null, paidCents: null, remainingCents: null, closedAt: "2026-10-15T15:00:00.000Z" })] };
  render(<CaixaQueueList queue={cega} selectedId={null} onPick={() => {}} now={new Date("2026-10-15T15:00:00.000Z")} />);
  const pagas = screen.getByRole("region", { name: "Pagas hoje" });
  expect(pagas.textContent).toContain("Lia");
  expect(pagas.textContent).not.toMatch(/R\$/);
});

it("r66 #3: ordem A receber, Em atendimento, Agendadas, Pagas hoje; seção vazia vira uma linha 'Nenhuma'", () => {
  const vazia: CaixaQueue = { aReceber: Q.aReceber, emAtendimento: [], pagasHoje: [] };
  const { container } = render(<CaixaQueueList queue={vazia} selectedId={null} onPick={() => {}} now={new Date("2026-10-15T15:00:00.000Z")} agendadas={<section aria-label="Agendadas de hoje"><h2>Agendadas de hoje</h2></section>} />);
  expect([...container.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"))).toEqual(["A receber", "Em atendimento", "Agendadas de hoje", "Pagas hoje"]);
  const em = screen.getByRole("region", { name: "Em atendimento" });
  expect(em.textContent).toBe("Em atendimentoNenhuma");
  expect(em.querySelector("ul")).toBeNull();
});

it("psico r68 #2: nada de 'Cancelar comanda' vermelho repetido; cada cartão tem um '⋯' discreto com o cancelar dentro", () => {
  const { container } = render(<CaixaQueueList queue={Q} selectedId={null} onPick={() => {}} now={new Date("2026-10-15T15:00:00.000Z")} canCancel />);
  expect(screen.queryAllByRole("button", { name: /^Cancelar/ })).toHaveLength(0);
  expect(container.querySelectorAll(".text-alert").length).toBeLessThanOrEqual(1); // só o "falta R$" da Rosa
  const mais = screen.getAllByRole("button", { name: /^Mais ações:/ });
  expect(mais).toHaveLength(3); // A receber (2) e Em atendimento (1); paga não cancela por aqui
  fireEvent.click(screen.getByRole("button", { name: "Mais ações: Rosa, nº 3" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar comanda" }));
  expect(screen.getByRole("dialog", { name: "Cancelar a comanda 3 · Rosa?" })).toBeTruthy();
});
