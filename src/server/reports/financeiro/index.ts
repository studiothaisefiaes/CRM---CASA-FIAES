import { sql } from "drizzle-orm";
import { rows } from "../common";
import { avecUntil, type DayRange } from "../salon";
import type { SalonRange } from "../../../lib/salon-period";
import type { CaixaMode } from "../../../lib/caixa-settings";
import { getCaixaMode } from "../../domain/caixa/mode";
import { financeEntradas, type FinanceCashier, type FinanceDay, type FinanceMethod, type Side } from "./entradas";
import { financeItens, type FinanceCommission, type FinanceGroup, type FinancePackages, type FinancePro } from "./itens";
import { financeExceptions, type FinanceException } from "./excecoes";
import { methodKey, methodLabel } from "./methods";

export type { FinanceCashier, FinanceDay, FinanceMethod, Side } from "./entradas";
export type { FinanceCommission, FinanceGroup, FinanceItem, FinancePackages, FinancePro } from "./itens";
export type { ExceptionKind, FinanceException } from "./excecoes";

/** Relatórios › Financeiro (plano 4): o caixa do CRM e os pagamentos do Avec do mesmo período, lado a lado, sem somar. */
export type FinanceView = {
  range: SalonRange; avecUntil: string | null; caixaMode: CaixaMode; crm: Side; avec: Side; days: FinanceDay[]; methods: FinanceMethod[];
  cashiers: FinanceCashier[]; professionals: FinancePro[]; services: FinanceGroup[]; categories: FinanceGroup[]; packages: FinancePackages;
  commission: FinanceCommission; exceptions: FinanceException[];
};

export async function loadFinanceiro(range: SalonRange): Promise<FinanceView> {
  const [e, i, exceptions, until, caixaMode] = await Promise.all([financeEntradas(range), financeItens(range), financeExceptions(range), avecUntil(), getCaixaMode()]);
  return { range, avecUntil: until, caixaMode, ...e, ...i, exceptions };
}

/** Uma venda por linha (aba Vendas do Excel): comanda fechada do CRM ou comanda do Avec com pagamento no período. */
export type FinanceSale = { origin: "crm" | "avec"; day: string; comanda: string; client: string | null; cashier: string | null; totalCents: number; methods: string };

export async function financeSales(r: DayRange): Promise<FinanceSale[]> {
  const [crm, avec] = await Promise.all([
    rows<{ day: string; number: number; client: string | null; cashier: string | null; total: number | null; methods: string[] | null }>(sql`
      select c.day::text as day, c.number, c.client_name as client, coalesce(initcap(lower(u.signature)), u.name) as cashier, c.total_cents as total,
        (select array_agg(cp.method order by cp.created_at) from comanda_payments cp where cp.comanda_id = c.id and cp.cancelled_at is null) as methods
      from comandas c left join cash_sessions cs on cs.id = c.cash_session_id left join users u on u.id = cs.opened_by
      where c.status = 'fechada' and c.day between ${r.from}::date and ${r.to}::date order by c.day, c.number`),
    rows<{ day: string; comanda: string; client: string | null; total: number; methods: string[] | null }>(sql`
      select min(coalesce(sp.paid_on, sp.comanda_on))::text as day, coalesce(sp.comanda, '') as comanda, max(sp.client_name) as client,
        sum(sp.value_cents)::int as total, array_agg(distinct coalesce(sp.method, 'Não informada')) as methods
      from sales_payments sp where coalesce(sp.paid_on, sp.comanda_on) between ${r.from}::date and ${r.to}::date
      group by sp.comanda_on, coalesce(sp.comanda, sp.id::text), sp.comanda order by 1, 2`),
  ]);
  const crmLabels = (m: string[] | null) => [...new Set((m ?? []).map((x) => methodLabel(methodKey(x))))].join(" + ");
  return [
    ...crm.map((c) => ({ origin: "crm" as const, day: c.day, comanda: String(c.number), client: c.client, cashier: c.cashier, totalCents: c.total ?? 0, methods: crmLabels(c.methods) })),
    ...avec.map((a) => ({ origin: "avec" as const, day: a.day, comanda: a.comanda, client: a.client, cashier: null, totalCents: a.total, methods: (a.methods ?? []).join(" + ") })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.origin.localeCompare(b.origin));
}
