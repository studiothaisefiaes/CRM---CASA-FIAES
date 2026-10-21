// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { money } from "@/lib/format";
import { CommissionTable } from "./commission-table";
import type { CommissionLine, CommissionReport } from "@/server/domain/caixa/commission";

afterEach(cleanup);
/** O `money` usa espaço não separável; compara pelo texto com espaço comum. */
const T = (t: string) => (_: string, n: Element | null) => !!n && n.children.length === 0 && (n.textContent ?? "").replace(/\s/g, " ") === t.replace(/\s/g, " ");
const line = (o: Partial<CommissionLine>): CommissionLine => ({
  itemId: "i1", assistantId: null, day: "2026-10-05", comandaNumber: 12, clientName: "Bia", label: "Corte", kind: "servico", role: "principal", principalName: null,
  baseCents: 10000, bp: 4000, commissionCents: 3000, status: "ok", grossCents: 4000, deductions: { cartao: 400, antecipacao: 280, custo: 320, assistentes: 0 }, payoutNumber: null, payoutId: null, ...o,
});
const report = (lines: CommissionLine[], o: { pending?: number; held?: number } = {}): CommissionReport => ({ from: "2026-10-01", to: "2026-10-31", pending: o.pending ?? 0, held: o.held ?? 0,
  rows: [{ professionalId: "p1", name: "Ana", active: true, lines, baseCents: 10000, commissionCents: 3000, pending: o.pending ?? 0, held: o.held ?? 0 }] });

it("cada linha mostra Bruta, Descontos e Comissão; o total de descontos é a soma de cada um", () => {
  render(<CommissionTable report={report([line({})])} />);
  const t = within(screen.getByRole("table"));
  expect(t.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Bruta", "Descontos", "Comissão"]));
  const row = within(t.getAllByRole("row")[1]);
  expect(row.getByText(T(`${money(4000)}`))).toBeTruthy();
  expect(row.getByText(T(`− ${money(1000)}`))).toBeTruthy();
  expect(row.getByText(T(`${money(3000)}`))).toBeTruthy();
  // o detalhe de cada desconto fica ao alcance (title)
  expect(row.getByText(T(`− ${money(1000)}`)).getAttribute("title")).toBe(`Taxa do cartão ${money(400)} · Antecipação ${money(280)} · Custo do serviço ${money(320)}`);
});

it("sem descontos: traço; sem retrato (comanda antiga): bruta e descontos em traço", () => {
  render(<CommissionTable report={report([line({ deductions: { cartao: 0, antecipacao: 0, custo: 0, assistentes: 0 }, grossCents: 3500 }), line({ itemId: "i2", grossCents: null, deductions: null })])} />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText(T(`${money(3500)}`), { selector: "td" })).toBeTruthy();
  expect(within(rows[1]).getAllByText("—").length).toBeGreaterThanOrEqual(2);
});

it("a linha da assistente diz de quem ela é assistente, sem bruta nem descontos", () => {
  render(<CommissionTable report={report([line({ role: "assistente", assistantId: "a1", principalName: "Ana", label: "Corte (assistente de Ana)", grossCents: null, deductions: null, commissionCents: 400, baseCents: 4000, bp: 1000 })])} />);
  expect(screen.getByText("Corte (assistente de Ana)")).toBeTruthy();
});

it("descontos da assistente aparecem na linha da principal; pendência", () => {
  render(<CommissionTable report={report([
    line({ deductions: { cartao: 0, antecipacao: 0, custo: 0, assistentes: 400 }, grossCents: 4000, commissionCents: 3600 }),
    line({ itemId: "i3", status: "aguardando_quitacao", commissionCents: null, payoutNumber: null }),
  ])} />);
  expect(screen.getByText(T(`− ${money(400)}`)).getAttribute("title")).toBe(`Assistente ${money(400)}`);
  expect(screen.getByText("Espera a cliente quitar a dívida")).toBeTruthy();
});

it("retidas pela dívida ficam fora do aviso de pendências, com aviso próprio", () => {
  render(<CommissionTable report={report([line({}), line({ itemId: "i3", status: "aguardando_quitacao" })], { held: 1 })} />);
  expect(screen.queryByText(/sem regra ou sem valor da sessão/)).toBeNull();
  expect(screen.getByText("1 linha espera a cliente quitar a dívida: entra na comissão quando ela pagar.")).toBeTruthy();
  cleanup();
  render(<CommissionTable report={report([line({}), line({ itemId: "i3", status: "sem_regra" }), line({ itemId: "i4", status: "aguardando_quitacao" }), line({ itemId: "i5", status: "aguardando_quitacao" })], { pending: 1, held: 2 })} />);
  expect(screen.getByText("1 linha sem regra ou sem valor da sessão: preencha em Regras ou em Pacotes.")).toBeTruthy();
  expect(screen.getByText("2 linhas esperam a cliente quitar a dívida: entram na comissão quando ela pagar.")).toBeTruthy();
});

it("linha paga mostra o recibo, que abre", () => {
  render(<CommissionTable report={report([line({ payoutNumber: 4, payoutId: "r4" })])} />);
  const link = screen.getByRole("link", { name: "Recibo nº 4" });
  expect(link.getAttribute("href")).toBe("/caixa/comissao/recibo/r4");
});
