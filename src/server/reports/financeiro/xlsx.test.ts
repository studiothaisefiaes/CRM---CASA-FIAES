import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { salonRange } from "@/lib/salon-period";
import { buildFinanceiroXlsx, FIN_SHEETS, financeiroFileName } from "./xlsx";
import type { FinanceView } from "./index";
import type { ResultadoView } from "./resultado";
import type { ExpenseRow } from "../../domain/financeiro/despesas";

const range = salonRange({ de: "2026-10-01", ate: "2026-10-15" }, new Date("2026-10-15T15:00:00Z"));
const view: FinanceView = {
  range, avecUntil: "2026-10-14", caixaMode: "avec",
  crm: { entradasCents: 5000, comandas: 1, ticketCents: 5000, taxasCents: 0, liquidoCents: 5000 }, avec: { entradasCents: 8000, comandas: 2, ticketCents: 4000, taxasCents: 0, liquidoCents: 8000 },
  days: [{ key: "2026-10-15", label: "15/10", crmCents: 5000, avecCents: 8000 }],
  methods: [{ key: "pix", label: "Pix", revenue: true, crmCents: 5000, crmFeeCents: 0, crmN: 1, avecCents: 0, avecN: 0 }],
  cashiers: [{ sessionId: "s1", day: "2026-10-15", userName: "Cati", openedAt: "2026-10-15T12:00:00.000Z", closedAt: null, status: "aberto", openingCents: 10000, entradasCents: 5000, comandas: 1, differenceCents: null, differences: [] }],
  professionals: [], services: [], categories: [],
  packages: { crm: { vendidos: 0, cents: 0, sessoes: 0 }, avec: { vendidos: 0, cents: 0, sessoes: 0 }, byName: [] },
  commission: { crmCents: 0, crmPending: 0, avecCents: null },
  exceptions: [{ origin: "crm", kind: "desconto_item", day: "2026-10-15", at: "2026-10-15T15:00:00.000Z", comanda: "1", client: "=HYPERLINK(\"x\")", item: "Corte", who: "Cati", beforeCents: 12000, afterCents: 10000, valueCents: 2000, reason: null }],
};

describe("Excel do Financeiro", () => {
  it("as 6 abas de sempre, valores em reais com formato R$ e texto perigoso neutralizado", async () => {
    const buf = await buildFinanceiroXlsx(view, { sales: [{ origin: "avec", day: "2026-10-15", comanda: "7", client: "+5571999", cashier: null, totalCents: 8000, methods: "Pix" }], items: [], geradoPor: "Thaíse", geradoEm: new Date("2026-10-15T15:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(FIN_SHEETS.slice(0, 6)); // sem Despesas/Resultado: funções desligadas
    const painel = wb.getWorksheet("Painel")!;
    const text = painel.getSheetValues().flat().map(String).join("|");
    expect(text).toContain("Entradas CRM");
    expect(text).toContain("Entradas Avec");
    const formas = wb.getWorksheet("Formas")!;
    const pix = formas.getRow(2);
    expect([pix.getCell(1).value, pix.getCell(2).value, pix.getCell(3).value]).toEqual(["Pix", 50, 0]);
    expect(formas.getRow(1).values).toEqual(expect.arrayContaining(["Taxa (CRM)", "Líquido (CRM)"]));
    expect(String(pix.getCell(2).numFmt)).toContain("R$");
    expect(wb.getWorksheet("Exceções")!.getRow(2).values).toContain("'=HYPERLINK(\"x\")");
    expect(wb.getWorksheet("Vendas")!.getRow(2).values).toContain("'+5571999");
  });
  it("Despesas e Resultado entram nesta ordem, depois de Exceções, quando vierem", async () => {
    const resultado: ResultadoView = { range, fluxo: [{ key: "2026-10-15", label: "15/10", entradasCrmCents: 5000, entradasAvecCents: 8000, saidasCents: 1000, aPagarCents: 500 }],
      dre: [{ key: "receita_servicos", label: "Serviços", crmCents: 5000, avecCents: 8000 }, { key: "taxas_cartao", label: "Taxas de cartão", crmCents: null, avecCents: null }],
      resultado: { crmCents: 5000, avecCents: 8000 }, contas: [{ id: "a", name: "Itaú", saldoCents: 12300 }] };
    const expenses = [{ title: "=Luz", categoryName: "Energia", supplier: null, competence: "2026-10-01", dueOn: "2026-10-10", paidOn: null, amountCents: 30000, paidCents: null, status: "atrasada", installment: 1, installments: 1 }] as unknown as ExpenseRow[];
    const buf = await buildFinanceiroXlsx(view, { sales: [], items: [], geradoPor: "T", geradoEm: new Date("2026-10-15T15:00:00Z"), resultado, expenses });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...FIN_SHEETS]);
    expect(FIN_SHEETS.slice(5)).toEqual(["Exceções", "Despesas", "Resultado"]);
    const d = wb.getWorksheet("Despesas")!.getRow(2).values as unknown[];
    expect(d).toContain("'=Luz");
    expect(d).toContain(300);
    const r = wb.getWorksheet("Resultado")!.getSheetValues().flat().map(String).join("|");
    expect(r).toContain("Serviços");
    expect(r).toContain("Itaú");
    expect(r).toContain("15/10");
  });
  it("nome do arquivo pelo período", () => expect(financeiroFileName(range)).toBe("financeiro_2026-10-01_a_2026-10-15.xlsx"));
});
