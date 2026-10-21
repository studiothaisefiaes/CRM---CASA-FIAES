// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { salonRange } from "@/lib/salon-period";
import type { FinanceView } from "@/server/reports/financeiro";
import { FinanceTab } from "./financeiro";

afterEach(cleanup);
const range = salonRange({ de: "2026-10-01", ate: "2026-10-15" }, new Date("2026-10-15T15:00:00Z"));
const empty: FinanceView = {
  range, avecUntil: null, caixaMode: "avec",
  crm: { entradasCents: 0, comandas: 0, ticketCents: null, taxasCents: 0, liquidoCents: 0 }, avec: { entradasCents: 0, comandas: 0, ticketCents: null, taxasCents: 0, liquidoCents: 0 },
  days: [{ key: "2026-10-15", label: "15/10", crmCents: 0, avecCents: 0 }], methods: [], cashiers: [], professionals: [], services: [], categories: [],
  packages: { crm: { vendidos: 0, cents: 0, sessoes: 0 }, avec: { vendidos: 0, cents: 0, sessoes: 0 }, byName: [] },
  commission: { crmCents: 0, crmPending: 0, avecCents: null }, exceptions: [],
};
const full: FinanceView = {
  ...empty, avecUntil: "2026-10-14", caixaMode: "crm",
  crm: { entradasCents: 11000, comandas: 2, ticketCents: 5500, taxasCents: 813, liquidoCents: 10187 }, avec: { entradasCents: 8000, comandas: 1, ticketCents: 8000, taxasCents: 0, liquidoCents: 8000 },
  days: [{ key: "2026-10-15", label: "15/10", crmCents: 11000, avecCents: 8000 }],
  methods: [{ key: "pix", label: "Pix", revenue: true, crmCents: 5000, crmFeeCents: 813, crmN: 1, avecCents: 8000, avecN: 1 }, { key: "cortesia", label: "Cortesia", revenue: false, crmCents: 3000, crmFeeCents: 0, crmN: 1, avecCents: 0, avecN: 0 }],
  cashiers: [{ sessionId: "s1", day: "2026-10-15", userName: "Cati", openedAt: "2026-10-15T12:00:00.000Z", closedAt: null, status: "aberto", openingCents: 10000, entradasCents: 11000, comandas: 1, differenceCents: null, differences: [] }],
  professionals: [{ key: "p1", name: "Ana", crmCents: 10800, crmItens: 1, avecCents: 0, avecItens: 0, crmCommissionCents: 4320, avecCommissionCents: null }],
  services: [{ key: "corte", label: "Corte", category: "Cabelo", crmN: 1, crmCents: 10800, avecN: 0, avecCents: 0 }],
  categories: [{ key: "cabelo", label: "Cabelo", crmN: 1, crmCents: 10800, avecN: 0, avecCents: 0 }],
  packages: { crm: { vendidos: 1, cents: 50000, sessoes: 2 }, avec: { vendidos: 0, cents: 0, sessoes: 1 }, byName: [{ name: "Pacote 4 escovas", crm: 1, avec: 0 }] },
  commission: { crmCents: 4320, crmPending: 1, avecCents: null },
  exceptions: [{ origin: "crm", kind: "desconto_item", day: "2026-10-15", at: "2026-10-15T15:00:00.000Z", comanda: "1", client: "Paula", item: "Hidratação", who: "Cati", beforeCents: 9000, afterCents: 8000, valueCents: 1000, reason: null }],
};

describe("aba Financeiro", () => {
  it("com dados: as seções, CRM ao lado do Avec com a diferença, exceção com quem fez e o Excel", () => {
    render(<FinanceTab d={full} excelHref="/api/relatorios/excel-financeiro?de=2026-10-01&ate=2026-10-15" canCommission />);
    for (const h of ["Entradas", "Formas de pagamento", "Por caixa", "Por profissional", "Por serviço e categoria", "Exceções", "Pacotes", "Comissão"]) {
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    }
    expect(screen.getAllByText("Diferença").length).toBeGreaterThan(0);
    for (const t of ["Taxas do cartão no CRM", "Líquido no CRM", "Taxa (CRM)", "Líquido (CRM)"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 8,13").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cati").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sem motivo registrado").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Baixar Excel" }).getAttribute("href")).toBe("/api/relatorios/excel-financeiro?de=2026-10-01&ate=2026-10-15");
    expect(screen.getByRole("link", { name: "Ver a comissão por linha" }).getAttribute("href")).toBe("/caixa/comissao?aba=relatorio&de=2026-10-01&ate=2026-10-15");
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
  it("Exceções: contagem por tipo, só as 5 mais recentes e \"Ver todas\" com o mesmo período, só com a permissão", () => {
    const mk = (kind: "sangria" | "desconto_item", i: number) => ({ ...full.exceptions[0], kind, item: `Item ${i}`, at: `2026-10-15T1${i}:00:00.000Z` });
    const exceptions = [...[1, 2, 3, 4, 5].map((i) => mk("desconto_item", i)), mk("sangria", 6), mk("sangria", 7)];
    const { container, rerender } = render(<FinanceTab d={{ ...full, exceptions }} excelHref={null} canExcecoes />);
    const sec = container.querySelector("#fin-excecoes-t")!.closest("section")!;
    const counts = sec.querySelector("ul[aria-label='Exceções por tipo']")!.textContent!;
    expect(counts).toContain("5 Desconto no item"); expect(counts).toContain("2 Sangria");
    expect(sec.querySelectorAll("tbody tr").length).toBe(5);
    expect(sec.textContent).toContain("As 5 mais recentes de 7.");
    expect(screen.getByRole("link", { name: "Ver todas" }).getAttribute("href")).toBe("/relatorios/excecoes?de=2026-10-01&ate=2026-10-15");
    rerender(<FinanceTab d={{ ...full, exceptions }} excelHref={null} />);
    expect(screen.queryByRole("link", { name: "Ver todas" })).toBeNull();
    expect(container.querySelector("#fin-excecoes-t")!.closest("section")!.querySelector("ul[aria-label='Exceções por tipo']")).not.toBeNull();
  });
  it("Por caixa (QA r58, C-1): a diferença de cada forma, nunca a soma zero", () => {
    const fechado = { ...full.cashiers[0], status: "fechado" as const, differenceCents: 0, differences: [{ method: "dinheiro" as const, cents: -10000 }, { method: "pix" as const, cents: 10000 }] };
    const { container } = render(<FinanceTab d={{ ...full, cashiers: [fechado] }} excelHref={null} canCommission />);
    const caixas = container.querySelector("#fin-caixas-t")!.closest("section")!;
    expect(caixas.textContent?.replace(/\s/g, " ")).toContain("Dinheiro -R$ 100Pix R$ 100");
  });
  it("Por caixa (revisão): caixa reaberto (aberto) mostra '—', não a diferença do fechamento anterior", () => {
    const reaberto = { ...full.cashiers[0], status: "aberto" as const, differenceCents: -500, differences: [] };
    const { container } = render(<FinanceTab d={{ ...full, cashiers: [reaberto] }} excelHref={null} canCommission />);
    const linha = container.querySelector("#fin-caixas-t")!.closest("section")!.querySelector("tbody tr")!;
    expect(linha.lastElementChild!.textContent).toBe("—");
  });
  it("vazio e com o caixa no Avec: avisa que o CRM está desligado, sem NaN e sem Excel", () => {
    render(<FinanceTab d={empty} excelHref={null} canCommission />);
    expect(screen.getByText("O caixa do CRM ainda está desligado: os números do CRM aparecem quando ele for ligado.")).toBeTruthy();
    expect(screen.getByText("Nenhum pagamento no período.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Baixar Excel" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
  it("Diferença sem cor de certo/errado (CRM e Avec não são meta um do outro); sem comissao.ver, sem o link da Comissão", () => {
    const { container } = render(<FinanceTab d={full} excelHref={null} canCommission={false} />);
    const formas = container.querySelector("#fin-formas-t")!.closest("section")!;
    expect(formas.querySelectorAll(".text-alert, .text-ok").length).toBe(0);
    expect(screen.queryByRole("link", { name: "Ver a comissão por linha" })).toBeNull();
  });
  it("r68 #20: sem Avec no período (só CRM), as colunas e números do Avec somem; nada de 'R$ 0' e 'não importada' em série", () => {
    const soCrm: FinanceView = { ...full, avecUntil: null, avec: { entradasCents: 0, comandas: 0, ticketCents: null, taxasCents: 0, liquidoCents: 0 },
      days: [{ key: "2026-10-15", label: "15/10", crmCents: 11000, avecCents: 0 }], methods: full.methods.map((m) => ({ ...m, avecCents: 0, avecN: 0 })),
      packages: { ...full.packages, avec: { vendidos: 0, cents: 0, sessoes: 0 } } };
    render(<FinanceTab d={soCrm} excelHref={null} />);
    expect(screen.queryAllByRole("columnheader", { name: /Avec/ })).toHaveLength(0);
    expect(screen.queryByText("Entradas no Avec")).toBeNull();
    expect(screen.queryByText("Comissão no Avec")).toBeNull();
    expect(screen.queryByText("não importada")).toBeNull();
    expect(screen.queryAllByRole("columnheader", { name: "Diferença" })).toHaveLength(0);
    expect(screen.getByTestId("fonte-financeiro").textContent).toContain("Só o CRM");
  });
  it("r68 #20: caixas fechados sem entrada viram uma linha só", () => {
    const zero = (i: number) => ({ ...full.cashiers[0], sessionId: `z${i}`, userName: "Rita", status: "fechado" as const, entradasCents: 0, comandas: 0, differenceCents: 0, day: `2026-10-0${i}` });
    render(<FinanceTab d={{ ...full, cashiers: [full.cashiers[0], ...[1, 2, 3, 4].map(zero)] }} excelHref={null} />);
    const sec = document.querySelector("#fin-caixas-t")!.closest("section")!;
    expect(sec.querySelectorAll("tbody tr").length).toBe(1);
    expect(sec.textContent).toContain("Mais 4 caixas fechados sem entrada");
  });
});
