import ExcelJS from "exceljs";
import type { SalonRange } from "../../../lib/salon-period";
import { EXCEPTION_LABEL } from "./excecoes";
import type { FinanceItem } from "./itens";
import type { ResultadoView } from "./resultado";
import type { ExpenseRow } from "../../domain/financeiro/despesas";
import type { FinanceSale, FinanceView } from "./index";

/**
 * Excel do Financeiro (plano 4), no molde do fechamento do Norte Vendas: Painel, Formas, Caixas, Vendas, Itens e Exceções. Valores em reais
 * (número com formato R$), CRM e Avec em colunas separadas, nunca somados.
 */
export const FIN_SHEETS = ["Painel", "Formas", "Caixas", "Vendas", "Itens", "Exceções", "Despesas", "Resultado"] as const;
/** Despesas e Resultado só entram quando a função está ligada (Contas a pagar → Despesas; Resultado → Resultado): sem os dados, o Excel sai com as 6 abas de sempre. */
export const financeiroFileName = (r: Pick<SalonRange, "from" | "to">) => `financeiro_${r.from}_a_${r.to}.xlsx`;

const FONT = "Calibri";
const BRL = '"R$" #,##0.00';
const HEAD = "FF2B2622"; // tinta da Casa
const reais = (c: number | null | undefined) => (c == null ? null : c / 100);
/** Texto que começa com = + - @ viraria fórmula no Excel (injeção de planilha). */
export const safeCell = (v: string | null | undefined): string | null => (v == null ? null : /^[=+\-@]/.test(v) ? `'${v}` : v);
/** O Excel não guarda fuso: grava o relógio de Salvador (UTC−3). */
const bahia = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3_600_000) : null);
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const EXPENSE_STATUS: Record<string, string> = { paga: "Paga", atrasada: "Atrasada", vence_7d: "A vencer", em_aberto: "Em aberto" };
const ORIGIN = { crm: "CRM", avec: "Avec" } as const;

type Col = { header: string; width: number; fmt?: string };
function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const r = ws.getRow(1);
  r.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  r.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

export async function buildFinanceiroXlsx(v: FinanceView, d: { sales: FinanceSale[]; items: FinanceItem[]; geradoPor: string; geradoEm: Date; resultado?: ResultadoView | null; expenses?: ExpenseRow[] | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.geradoPor;
  wb.created = d.geradoEm;

  const p = sheet(wb, "Painel", [{ header: "Financeiro", width: 30 }, { header: "CRM", width: 18, fmt: BRL }, { header: "Avec", width: 18, fmt: BRL }, { header: "Diferença (CRM − Avec)", width: 24, fmt: BRL }]);
  p.addRow([`Período: ${v.range.label}`]);
  p.addRow([`Gerado em ${d.geradoEm.toLocaleString("pt-BR", { timeZone: "America/Bahia" })} por ${d.geradoPor}`]);
  p.addRow([v.avecUntil ? `Avec importado até ${v.avecUntil.split("-").reverse().join("/")}` : "Ainda não há dados do Avec"]);
  p.addRow([]);
  p.addRow(["Entradas CRM", reais(v.crm.entradasCents)]);
  p.addRow(["Entradas Avec", null, reais(v.avec.entradasCents)]);
  p.addRow(["Entradas", reais(v.crm.entradasCents), reais(v.avec.entradasCents), reais(v.crm.entradasCents - v.avec.entradasCents)]);
  p.addRow(["Taxas do cartão no CRM", reais(v.crm.taxasCents)]);
  p.addRow(["Líquido no CRM", reais(v.crm.liquidoCents)]);
  const n = p.addRow(["Comandas", v.crm.comandas, v.avec.comandas, v.crm.comandas - v.avec.comandas]);
  n.numFmt = "0";
  p.addRow(["Ticket médio", reais(v.crm.ticketCents), reais(v.avec.ticketCents)]);
  p.addRow(["Comissão", reais(v.commission.crmCents), reais(v.commission.avecCents)]);
  p.addRow(["Pacotes vendidos (valor)", reais(v.packages.crm.cents), reais(v.packages.avec.cents)]);
  p.addRow([]);
  p.addRow(["Por dia", "CRM", "Avec", "Diferença"]).font = { bold: true };
  for (const x of v.days) p.addRow([x.label, reais(x.crmCents), reais(x.avecCents), reais(x.crmCents - x.avecCents)]);

  const f = sheet(wb, "Formas", [{ header: "Forma", width: 24 }, { header: "CRM", width: 16, fmt: BRL }, { header: "Avec", width: 16, fmt: BRL }, { header: "Diferença", width: 16, fmt: BRL },
    { header: "Pagamentos CRM", width: 16 }, { header: "Pagamentos Avec", width: 16 }, { header: "Entra nas entradas", width: 18 },
    { header: "Taxa (CRM)", width: 14, fmt: BRL }, { header: "Líquido (CRM)", width: 16, fmt: BRL }]);
  for (const m of v.methods) f.addRow([safeCell(m.label), reais(m.crmCents), reais(m.avecCents), reais(m.crmCents - m.avecCents), m.crmN, m.avecN, m.revenue ? "Sim" : "Não", reais(m.crmFeeCents), reais(m.crmCents - m.crmFeeCents)]);

  const c = sheet(wb, "Caixas", [{ header: "Dia", width: 12, fmt: "dd/mm/yyyy" }, { header: "Pessoa", width: 22 }, { header: "Abertura", width: 18, fmt: "dd/mm/yyyy hh:mm" },
    { header: "Fechamento", width: 18, fmt: "dd/mm/yyyy hh:mm" }, { header: "Situação", width: 12 }, { header: "Fundo de troco", width: 16, fmt: BRL },
    { header: "Entradas", width: 16, fmt: BRL }, { header: "Comandas", width: 12 }, { header: "Diferença na contagem", width: 22, fmt: BRL }]);
  for (const x of v.cashiers) c.addRow([day(x.day), safeCell(x.userName), bahia(x.openedAt), bahia(x.closedAt), x.status === "aberto" ? "Aberto" : x.status === "fechado" ? "Fechado" : "",
    x.sessionId ? reais(x.openingCents) : null, reais(x.entradasCents), x.comandas, reais(x.differenceCents)]);

  const s = sheet(wb, "Vendas", [{ header: "Origem", width: 8 }, { header: "Dia", width: 12, fmt: "dd/mm/yyyy" }, { header: "Comanda", width: 10 }, { header: "Cliente", width: 28 },
    { header: "Caixa", width: 16 }, { header: "Total", width: 14, fmt: BRL }, { header: "Formas", width: 40 }]);
  for (const x of d.sales) s.addRow([ORIGIN[x.origin], day(x.day), safeCell(x.comanda), safeCell(x.client), safeCell(x.cashier), reais(x.totalCents), safeCell(x.methods)]);

  const it = sheet(wb, "Itens", [{ header: "Origem", width: 8 }, { header: "Dia", width: 12, fmt: "dd/mm/yyyy" }, { header: "Comanda", width: 10 }, { header: "Cliente", width: 26 },
    { header: "Item", width: 30 }, { header: "Tipo", width: 14 }, { header: "Categoria", width: 20 }, { header: "Profissional", width: 18 }, { header: "Valor", width: 13, fmt: BRL },
    { header: "Desconto", width: 13, fmt: BRL }, { header: "Líquido", width: 13, fmt: BRL }, { header: "Comissão", width: 13, fmt: BRL }]);
  for (const x of d.items) it.addRow([ORIGIN[x.origin], day(x.day), safeCell(x.comanda), safeCell(x.client), safeCell(x.item), x.kind, safeCell(x.category), safeCell(x.professional),
    reais(x.valueCents), reais(x.discountCents), reais(x.netCents), reais(x.commissionCents)]);

  const e = sheet(wb, "Exceções", [{ header: "Origem", width: 8 }, { header: "Dia", width: 12, fmt: "dd/mm/yyyy" }, { header: "Hora", width: 18, fmt: "dd/mm/yyyy hh:mm" },
    { header: "Tipo", width: 28 }, { header: "Comanda", width: 10 }, { header: "Cliente", width: 26 }, { header: "Item", width: 26 }, { header: "Quem fez", width: 16 },
    { header: "Antes", width: 13, fmt: BRL }, { header: "Depois", width: 13, fmt: BRL }, { header: "Valor", width: 13, fmt: BRL }, { header: "Motivo", width: 36 }]);
  for (const x of v.exceptions) e.addRow([ORIGIN[x.origin], day(x.day), bahia(x.at), EXCEPTION_LABEL[x.kind], safeCell(x.comanda), safeCell(x.client), safeCell(x.item),
    safeCell(x.who), reais(x.beforeCents), reais(x.afterCents), reais(x.valueCents), safeCell(x.reason ?? (x.origin === "crm" ? "sem motivo registrado" : null))]);

  if (d.expenses) {
    const x = sheet(wb, "Despesas", [{ header: "Despesa", width: 30 }, { header: "Categoria", width: 22 }, { header: "Fornecedor", width: 24 }, { header: "Competência", width: 13, fmt: "mm/yyyy" },
      { header: "Vencimento", width: 12, fmt: "dd/mm/yyyy" }, { header: "Pago em", width: 12, fmt: "dd/mm/yyyy" }, { header: "Valor", width: 14, fmt: BRL }, { header: "Valor pago", width: 14, fmt: BRL },
      { header: "Situação", width: 14 }, { header: "Parcela", width: 10 }]);
    for (const e of d.expenses) x.addRow([safeCell(e.title), safeCell(e.categoryName), safeCell(e.supplier), day(e.competence), day(e.dueOn), day(e.paidOn), reais(e.amountCents), reais(e.paidCents),
      EXPENSE_STATUS[e.status] ?? e.status, e.installments > 1 ? `${e.installment}/${e.installments}` : null]);
  }
  if (d.resultado) {
    const r = d.resultado;
    const w = sheet(wb, "Resultado", [{ header: "Resultado do período", width: 34 }, { header: "CRM", width: 18, fmt: BRL }, { header: "Avec", width: 18, fmt: BRL }, { header: "Diferença (CRM − Avec)", width: 24, fmt: BRL }]);
    w.addRow([`Período: ${r.range.label}`]);
    w.addRow(["CRM e Avec lado a lado, sem somar. As despesas são as mesmas nos dois. Linha vazia = sem dado."]);
    for (const l of r.dre) w.addRow([safeCell(l.label), reais(l.crmCents), reais(l.avecCents), l.crmCents == null || l.avecCents == null ? null : reais(l.crmCents - l.avecCents)]).getCell(1).font = { name: FONT };
    w.addRow(["Resultado", reais(r.resultado.crmCents), reais(r.resultado.avecCents), reais(r.resultado.crmCents - r.resultado.avecCents)]).font = { bold: true };
    w.addRow([]);
    w.addRow([r.range.grain === "dia" ? "Fluxo de caixa por dia" : "Fluxo de caixa por mês", "Entradas CRM", "Entradas Avec", "Saídas", "A pagar"]).font = { bold: true };
    for (const f of r.fluxo) { const row = w.addRow([f.label, reais(f.entradasCrmCents), reais(f.entradasAvecCents), reais(f.saidasCents), reais(f.aPagarCents)]); [2, 3, 4, 5].forEach((i) => { row.getCell(i).numFmt = BRL; }); }
    w.addRow([]);
    w.addRow(["Saldo por conta", "Saldo"]).font = { bold: true };
    for (const c of r.contas) w.addRow([safeCell(c.name), reais(c.saldoCents)]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
