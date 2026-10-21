// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = vi.fn(), replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }), useSearchParams: () => new URLSearchParams("aba=financeiro&vista=contas&periodo=mes") }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
const lancar = vi.fn(async (..._a: unknown[]) => ({ ok: true })), pagar = vi.fn(async (..._a: unknown[]) => ({ ok: true })), desfazer = vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  cancelar = vi.fn(async (..._a: unknown[]) => ({ ok: true })), catSave = vi.fn(async (..._a: unknown[]) => ({ ok: true })), contaSave = vi.fn(async (..._a: unknown[]) => ({ ok: true })), formaSave = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/relatorios/financeiro-actions", () => ({
  lancarDespesa: (...a: unknown[]) => lancar(...a), pagarDespesa: (...a: unknown[]) => pagar(...a), desfazerPagamento: (...a: unknown[]) => desfazer(...a),
  cancelarDespesa: (...a: unknown[]) => cancelar(...a), salvarCategoria: (...a: unknown[]) => catSave(...a), salvarConta: (...a: unknown[]) => contaSave(...a), salvarContaPorForma: (...a: unknown[]) => formaSave(...a),
}));
import type { ExpenseRow } from "@/server/domain/financeiro/despesas";
import { ContasAPagar } from "./contas-a-pagar";
import { FinanceViews } from "./financeiro-views";

beforeAll(() => { window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const base = { notes: null, supplier: null, competence: "2026-10-01", bankAccountId: null, paidMethod: null, seriesId: null, installment: 1, installments: 1, createdBy: null, createdAt: new Date(), cancelledAt: null, cancelledBy: null, cancelReason: null, paidCents: null };
const atrasada = { ...base, id: "00000000-0000-4000-8000-000000000001", title: "Luz", categoryId: "c1", categoryName: "Energia", amountCents: 30000, dueOn: "2026-10-10", paidOn: null, status: "atrasada" } as ExpenseRow;
const paga = { ...base, id: "00000000-0000-4000-8000-000000000002", title: "Aluguel", categoryId: "c2", categoryName: "Aluguel", amountCents: 450000, dueOn: "2026-10-05", paidOn: "2026-10-05", paidCents: 450000, status: "paga" } as ExpenseRow;
const venc = { ...base, id: "00000000-0000-4000-8000-000000000003", title: "Internet", categoryId: "c1", categoryName: "Energia", amountCents: 20000, dueOn: "2026-10-20", paidOn: null, status: "vence_7d" } as ExpenseRow;
const serie = { ...venc, id: "00000000-0000-4000-8000-000000000004", title: "Contador", seriesId: "00000000-0000-4000-8000-0000000000aa", installments: 3, dueOn: "2026-10-25" } as ExpenseRow;
const cats = [{ id: "c1", name: "Energia", dreGroup: "ocupacao", active: true, position: 1, createdAt: new Date() }, { id: "c2", name: "Aluguel", dreGroup: "ocupacao", active: true, position: 2, createdAt: new Date() }];
const accounts = [{ id: "a1", name: "Itaú", bank: "Itaú", openingCents: 0, active: true, createdAt: new Date() }];
const ALL = { lancar: true, pagar: true, cancelar: true, cadastros: true };
const NONE = { lancar: false, pagar: false, cancelar: false, cadastros: false };
const show = (rows: ExpenseRow[], can = ALL) => render(<ContasAPagar rows={rows} categories={cats} accounts={accounts} can={can} venceEmDias={7} today="2026-10-18" />);

describe("Contas a pagar", () => {
  it("pergunta da tela, totais por situação e a linha atrasada com o rótulo", () => {
    show([atrasada, paga, venc]);
    expect(screen.getByRole("heading", { name: "O que a Casa tem para pagar?" })).toBeTruthy();
    expect(screen.getAllByText("Atrasada").length).toBeGreaterThan(0);
    const txt = (el: Element) => el.closest("div")!.textContent!.replace(/\s/g, " ");
    expect(txt(screen.getByText("A pagar no período"))).toContain("R$ 500"); // 300 + 200, a paga não entra
    expect(txt(screen.getByText("Atrasadas"))).toContain("R$ 300");
    expect(txt(screen.getByText("Pagas no período"))).toContain("R$ 4.500");
  });
  it("o rótulo 'vence em' usa a janela configurada", () => {
    render(<ContasAPagar rows={[venc]} categories={cats} accounts={accounts} can={ALL} venceEmDias={10} today="2026-10-18" />);
    expect(screen.getAllByText("Vence em até 10 dias").length).toBeGreaterThan(0);
  });
  it("lista vazia: 'Nenhuma despesa no período.'", () => {
    show([]);
    expect(screen.getByText("Nenhuma despesa no período.")).toBeTruthy();
  });
  it("filtro de situação esconde as outras linhas", () => {
    show([atrasada, paga]);
    fireEvent.click(screen.getByRole("button", { name: "Paga" }));
    expect(screen.queryAllByText("Luz")).toHaveLength(0);
    expect(screen.getAllByText("Aluguel").length).toBeGreaterThan(0);
  });
  it("sem nenhuma permissão: sem Lançar, Pagar, Desfazer, Cancelar nem o bloco de cadastros", () => {
    show([atrasada, paga], NONE);
    for (const n of ["Lançar despesa", "Pagar", "Desfazer", "Cancelar"]) expect(screen.queryAllByRole("button", { name: new RegExp(`^${n}`) })).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Categorias e contas" })).toBeNull();
  });
  it("cada capacidade liga só o seu botão", () => {
    const { unmount } = show([atrasada, paga], { ...NONE, lancar: true });
    expect(screen.getByRole("button", { name: "Lançar despesa" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Pagar/ })).toHaveLength(0);
    unmount();
    const b = show([atrasada, paga], { ...NONE, pagar: true });
    expect(screen.queryByRole("button", { name: "Lançar despesa" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Pagar/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Desfazer/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Cancelar/ })).toHaveLength(0);
    b.unmount();
    show([atrasada, paga], { ...NONE, cancelar: true });
    expect(screen.getAllByRole("button", { name: /^Cancelar/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Categorias e contas" })).toBeNull();
  });
  it("cadastros: o bloco aparece só com financeiro.cadastros, com a conta de cada forma", () => {
    show([], { ...NONE, cadastros: true });
    expect(screen.getByRole("heading", { name: "Categorias e contas" })).toBeTruthy();
    expect(screen.getByLabelText("Conta do Pix")).toBeTruthy();
  });
  it("lança uma despesa repetida pela folha", async () => {
    show([]);
    fireEvent.click(screen.getByRole("button", { name: "Lançar despesa" }));
    const d = within(screen.getByRole("dialog"));
    fireEvent.change(d.getByLabelText("Despesa"), { target: { value: "Aluguel" } });
    fireEvent.change(d.getByLabelText("Categoria"), { target: { value: "c2" } });
    fireEvent.change(d.getByLabelText("Valor (R$)"), { target: { value: "4500,50" } });
    fireEvent.change(d.getByLabelText("Vencimento"), { target: { value: "2026-10-31" } });
    fireEvent.change(d.getByLabelText("Repetir por (meses)"), { target: { value: "3" } });
    await act(async () => { fireEvent.click(d.getByRole("button", { name: "Lançar" })); });
    expect(lancar).toHaveBeenCalledWith(expect.objectContaining({ title: "Aluguel", categoryId: "c2", amountCents: 450050, dueOn: "2026-10-31", repeatMonths: 3 }));
    expect(refresh).toHaveBeenCalled();
  });
  it("o limite de meses vem da configuração", () => {
    render(<ContasAPagar rows={[]} categories={cats} accounts={accounts} can={ALL} venceEmDias={7} repetirMaxMeses={12} today="2026-10-18" />);
    fireEvent.click(screen.getByRole("button", { name: "Lançar despesa" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Repetir por (meses)").getAttribute("max")).toBe("12");
  });
  it("paga pela folha com data, valor, conta e forma", async () => {
    show([atrasada]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Pagar/ })[0]);
    const d = within(screen.getByRole("dialog"));
    fireEvent.change(d.getByLabelText("Conta"), { target: { value: "a1" } });
    fireEvent.change(d.getByLabelText("Forma de pagamento"), { target: { value: "boleto" } });
    await act(async () => { fireEvent.click(d.getByRole("button", { name: "Registrar pagamento" })); });
    expect(pagar).toHaveBeenCalledWith(atrasada.id, { paidOn: "2026-10-18", paidCents: 30000, bankAccountId: "a1", method: "boleto" });
  });
  it("desfaz o pagamento", async () => {
    show([paga]);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Desfazer/ })[0]); });
    expect(desfazer).toHaveBeenCalledWith(paga.id);
  });
  it("cancelar uma parcela de série oferece 'esta e as próximas' e exige o motivo", async () => {
    show([serie]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Cancelar/ })[0]);
    const d = within(screen.getByRole("dialog"));
    fireEvent.click(d.getByRole("radio", { name: /próximas/ }));
    fireEvent.change(d.getByLabelText("Motivo"), { target: { value: "Contrato encerrado" } });
    await act(async () => { fireEvent.click(d.getByRole("button", { name: "Cancelar despesa" })); });
    expect(cancelar).toHaveBeenCalledWith(serie.id, { reason: "Contrato encerrado", scope: "proximas" });
  });
  it("erro do servidor aparece na folha, em frase", async () => {
    pagar.mockResolvedValueOnce({ ok: false, error: "Essa despesa já está paga." } as never);
    show([atrasada]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Pagar/ })[0]);
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar pagamento" })); });
    expect(screen.getByRole("alert").textContent).toBe("Essa despesa já está paga.");
  });
  it("salva a conta de cada forma", async () => {
    show([], { ...NONE, cadastros: true });
    fireEvent.change(screen.getByLabelText("Conta do Pix"), { target: { value: "a1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar contas por forma" })); });
    expect(formaSave).toHaveBeenCalledWith({ pix: "a1" });
  });
});

describe("abas do Financeiro", () => {
  it("Contas a pagar e Notas fiscais só aparecem quando ligadas; Entradas sempre", () => {
    const { rerender } = render(<FinanceViews value="entradas" notas={false} contas={false} resultado={false} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Entradas"]);
    rerender(<FinanceViews value="contas" notas contas resultado={false} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Entradas", "Contas a pagar", "Notas fiscais"]);
  });
  it("trocar de aba guarda o período e põe ?vista=", () => {
    render(<FinanceViews value="entradas" notas={false} contas resultado={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contas a pagar" }));
    expect(replace).toHaveBeenCalledWith("/relatorios?aba=financeiro&vista=contas&periodo=mes", { scroll: false });
  });
});
