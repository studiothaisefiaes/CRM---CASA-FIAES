// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace }), useSearchParams: () => new URLSearchParams("aba=financeiro&vista=resultado&periodo=mes") }));
import { salonRange } from "@/lib/salon-period";
import type { ResultadoView } from "@/server/reports/financeiro/resultado";
import { ResultadoTab } from "./resultado";
import { FinanceViews } from "./financeiro-views";

beforeAll(() => { window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const range = salonRange({ de: "2026-10-01", ate: "2026-10-31" }, new Date("2026-10-18T12:00:00Z"));
const v: ResultadoView = {
  range,
  fluxo: [{ key: "2026-10-05", label: "05/10", entradasCrmCents: 10000, entradasAvecCents: 8000, saidasCents: 3000, aPagarCents: 2000 }],
  dre: [
    { key: "receita_servicos", label: "Serviços", crmCents: 10000, avecCents: 8000 },
    { key: "repasse_profissionais", label: "Comissões", crmCents: 4000, avecCents: 3200 },
    { key: "taxas_cartao", label: "Taxas de cartão", crmCents: null, avecCents: null },
    { key: "ocupacao", label: "Ocupação", crmCents: 3000, avecCents: 3000 },
  ],
  resultado: { crmCents: 3000, avecCents: 1800 },
  contas: [{ id: "a1", name: "Itaú", saldoCents: 123400 }],
};

describe("Resultado", () => {
  it("pergunta, DRE com as colunas CRM e Avec e o resultado do mês", () => {
    render(<ResultadoTab v={v} />);
    expect(screen.getByRole("heading", { name: "Quanto sobrou no mês?" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader", { name: "CRM" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Avec" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resultado").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Fluxo de caixa" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Saldo por conta" })).toBeTruthy();
    expect(screen.getAllByText("Itaú").length).toBeGreaterThan(0);
  });
  it("período que não é mês cheio: o aviso fixo dos meses inteiros aparece (M-2)", () => {
    const aviso = "O resultado usa meses inteiros: escolha um mês para comparar receita e despesas.";
    render(<ResultadoTab v={{ ...v, avisoMeses: aviso }} />);
    expect(screen.getByText(aviso)).toBeTruthy();
    cleanup();
    render(<ResultadoTab v={v} />);
    expect(screen.queryByText(aviso)).toBeNull();
  });
  it("dedução com '−'; linha sem dado mostra '—', nunca R$ 0,00", () => {
    render(<ResultadoTab v={v} />);
    const table = screen.getByRole("table", { name: "Resultado do período" });
    const taxas = within(table).getByText("Taxas de cartão").closest("tr")!;
    expect(taxas.textContent).toContain("—");
    expect(taxas.textContent).not.toContain("R$");
    const com = within(table).getByText("Comissões").closest("tr")!;
    expect(com.textContent).toContain("−");
  });
  it("aviso fixo", () => {
    render(<ResultadoTab v={v} />);
    expect(screen.getByText("CRM e Avec lado a lado, sem somar. As despesas são as mesmas nos dois.")).toBeTruthy();
  });
  it("a aba Resultado só aparece com a função ligada", () => {
    const { rerender } = render(<FinanceViews value="entradas" notas={false} contas={false} resultado={false} />);
    expect(screen.queryByRole("tab", { name: "Resultado" })).toBeNull();
    rerender(<FinanceViews value="entradas" notas={false} contas={false} resultado />);
    expect(screen.getByRole("tab", { name: "Resultado" })).toBeTruthy();
  });
});
