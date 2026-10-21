import { sql } from "drizzle-orm";
import { rows } from "../common";
import { REVENUE, type DayRange } from "../salon";
import { courtesyShares, splitDiscount } from "../../../lib/comanda-math";
import { normText } from "../../domain/avec/normalize";
import { commissionReport } from "../../domain/caixa/commission";

/**
 * Financeiro, o que foi vendido (plano 4): itens do CRM (comandas fechadas) e do Avec (`sales_items`), por profissional, serviço e
 * categoria, pacotes e comissão. Sessão de pacote vale 0 dos dois lados (o dinheiro entrou na venda do pacote), como no Salão.
 * O item "divida" (quitação de uma comanda anterior) fica de fora: o serviço já foi faturado na comanda que deixou a dívida.
 */
export type FinanceItem = {
  origin: "crm" | "avec"; day: string; comanda: string; client: string | null; item: string; kind: string; category: string;
  professional: string; proKey: string; valueCents: number | null; discountCents: number; netCents: number; commissionCents: number | null;
  /** A parte do item na cortesia da comanda (CRM), já fora do `netCents`. Cortesia aparece só em Formas e Exceções (QA r58, C-3). */
  courtesyCents?: number;
};
export type FinancePro = { key: string; name: string; crmCents: number; crmItens: number; avecCents: number; avecItens: number; crmCommissionCents: number | null; avecCommissionCents: number | null };
export type FinanceGroup = { key: string; label: string; category?: string; crmN: number; crmCents: number; avecN: number; avecCents: number };
type PkgSide = { vendidos: number; cents: number; sessoes: number };
export type FinancePackages = { crm: PkgSide; avec: PkgSide; byName: { name: string; crm: number; avec: number }[] };
export type FinanceCommission = { crmCents: number; crmPending: number; avecCents: number | null };
export type FinanceItens = { professionals: FinancePro[]; services: FinanceGroup[]; categories: FinanceGroup[]; packages: FinancePackages; commission: FinanceCommission };

const SEM_CATEGORIA = "Sem categoria", SEM_PRO = "Sem profissional";

type CrmRow = {
  id: string; comandaId: string; day: string; number: number; client: string | null; comandaDiscount: number; label: string; kind: string; qty: number;
  unit: number | null; discount: number; total: number | null; category: string | null; proId: string | null; pro: string | null; commission: number | null;
};

/** Itens vivos das comandas fechadas do período, com o líquido (o desconto da comanda e a cortesia rateados como no fechamento). */
export async function crmItems(r: DayRange): Promise<FinanceItem[]> {
  return (await crmItemsById(r)).map(({ id: _id, ...rest }) => rest);
}

/** Os mesmos itens com o id da linha (o Resultado usa para o valor dos itens fechados antes do `net_cents`). */
export async function crmItemsById(r: DayRange): Promise<(FinanceItem & { id: string })[]> {
  const x = await rows<CrmRow>(sql`
    select ci.id, c.id as "comandaId", c.day::text as day, c.number, c.client_name as client, c.discount_cents as "comandaDiscount", ci.label, ci.kind,
      ci.qty::float8 as qty, ci.unit_cents as unit, ci.discount_cents as discount, ci.total_cents as total, l.category, ci.professional_id as "proId",
      p.name as pro, ci.commission_cents as commission
    from comanda_items ci join comandas c on c.id = ci.comanda_id
      left join lists l on l.id = ci.service_id left join professionals p on p.id = ci.professional_id
    where c.status = 'fechada' and c.day between ${r.from}::date and ${r.to}::date and ci.cancelled_at is null
    order by c.day, c.number, ci.created_at, ci.id`);
  const gross = (i: CrmRow) => i.total ?? (i.unit == null ? 0 : Math.max(0, Math.round(i.qty * i.unit) - i.discount));
  const ids = [...new Set(x.map((i) => i.comandaId))];
  const courtesyOf = new Map(ids.length ? (await rows<{ id: string; v: number }>(sql`
    select cp.comanda_id as id, sum(cp.value_cents)::int as v from comanda_payments cp
    where cp.method = 'cortesia' and cp.cancelled_at is null and cp.comanda_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) group by 1`)).map((c) => [c.id, c.v]) : []);
  const shares = new Map<string, number>(), courtesy = new Map<string, number>();
  for (const id of ids) {
    const its = x.filter((i) => i.comandaId === id);
    // Como no fechamento (comandaTotals): o item de dívida fica fora do desconto e da cortesia.
    const sales = its.filter((i) => i.kind !== "divida").map((i) => ({ id: i.id, total: gross(i) }));
    const discount = Math.min(Math.max(0, its[0].comandaDiscount), sales.reduce((a, i) => a + i.total, 0));
    for (const [k, v] of splitDiscount(sales, discount)) shares.set(k, v);
    const nets = its.map((i) => ({ id: i.id, total: i.kind === "pacote_sessao" || i.kind === "divida" ? 0 : gross(i) - (shares.get(i.id) ?? 0) }));
    for (const [k, v] of courtesyShares(nets, courtesyOf.get(id) ?? 0)) courtesy.set(k, v);
  }
  // A dívida não é venda: fica fora daqui (o serviço foi faturado na comanda que deixou a dívida).
  return x.filter((i) => i.kind !== "divida").map((i) => ({
    id: i.id, origin: "crm", day: i.day, comanda: String(i.number), client: i.client, item: i.label, kind: i.kind, category: i.category?.trim() || SEM_CATEGORIA,
    professional: i.pro ?? SEM_PRO, proKey: i.proId ?? "sem", valueCents: i.unit == null ? null : Math.round(i.qty * i.unit), discountCents: i.discount + (shares.get(i.id) ?? 0),
    netCents: i.kind === "pacote_sessao" ? 0 : gross(i) - (shares.get(i.id) ?? 0) - (courtesy.get(i.id) ?? 0), commissionCents: i.commission,
    courtesyCents: courtesy.get(i.id) ?? 0,
  }));
}

type AvecRow = { day: string; comanda: string | null; client: string | null; item: string; kind: string; category: string | null; proKey: string; pro: string;
  value: number | null; discount: number | null; net: number; commission: number | null };

/** Itens do Avec no período (`sales_items`), com o mesmo valor do Salão. */
export async function avecItems(r: DayRange): Promise<FinanceItem[]> {
  const x = await rows<AvecRow>(sql`
    select si.sold_on::text as day, si.comanda, si.client_name as client, si.item, si.kind, si.category,
      coalesce(si.professional_id::text, 'nome:' || lower(nullif(trim(si.professional_name), '')), 'sem') as "proKey",
      coalesce(p.name, nullif(trim(si.professional_name), ''), ${SEM_PRO}) as pro,
      si.value_cents as value, si.discount_cents as discount, ${REVENUE()}::float8 as net, si.commission_cents as commission
    from sales_items si left join professionals p on p.id = si.professional_id
    where si.sold_on between ${r.from}::date and ${r.to}::date order by si.sold_on, si.comanda, si.id`);
  return x.map((i) => ({
    origin: "avec", day: i.day, comanda: i.comanda ?? "", client: i.client, item: i.item, kind: i.kind, category: i.category?.trim() || SEM_CATEGORIA,
    professional: i.pro, proKey: i.proKey, valueCents: i.value, discountCents: i.discount ?? 0, netCents: Number(i.net), commissionCents: i.commission,
  }));
}

const addNull = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);

function groupBy(items: FinanceItem[], keyOf: (i: FinanceItem) => string, labelOf: (i: FinanceItem) => string, withCategory = false): FinanceGroup[] {
  const m = new Map<string, FinanceGroup>();
  for (const i of items) {
    const k = keyOf(i);
    let g = m.get(k);
    if (!g) m.set(k, g = { key: k, label: labelOf(i), ...(withCategory ? { category: i.category } : {}), crmN: 0, crmCents: 0, avecN: 0, avecCents: 0 });
    if (i.origin === "crm") { g.crmN++; g.crmCents += i.netCents; if (withCategory) g.label = labelOf(i); } else { g.avecN++; g.avecCents += i.netCents; }
  }
  return [...m.values()].sort((a, b) => b.crmCents + b.avecCents - (a.crmCents + a.avecCents) || b.crmN + b.avecN - (a.crmN + a.avecN) || a.label.localeCompare(b.label, "pt-BR"));
}

/** Rótulo de categoria: o do CRM quando existe ("Cabelo"), senão o do Avec com só a 1ª maiúscula ("CABELO" → "Cabelo"). */
const tidy = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

async function packages(r: DayRange, crm: FinanceItem[]): Promise<FinancePackages> {
  const [avec, uses] = await Promise.all([
    rows<{ name: string; n: number; cents: number }>(sql`
      select package_name as name, count(*)::int as n, coalesce(sum(price_cents), 0)::int as cents from client_packages
      where origin <> 'crm' and cancelled_at is null and purchased_on between ${r.from}::date and ${r.to}::date group by 1`),
    rows<{ origin: string; n: number }>(sql`
      select case when origin = 'crm' then 'crm' else 'avec' end as origin, count(*)::int as n from package_uses
      where cancelled_at is null and used_on between ${r.from}::date and ${r.to}::date group by 1`),
  ]);
  const sold = crm.filter((i) => i.kind === "pacote_venda");
  const byName = new Map<string, { name: string; crm: number; avec: number }>();
  for (const i of sold) { const g = byName.get(i.item) ?? { name: i.item, crm: 0, avec: 0 }; g.crm++; byName.set(i.item, g); }
  for (const a of avec) { const g = byName.get(a.name) ?? { name: a.name, crm: 0, avec: 0 }; g.avec += a.n; byName.set(a.name, g); }
  return {
    crm: { vendidos: sold.length, cents: sold.reduce((t, i) => t + i.netCents, 0), sessoes: uses.find((u) => u.origin === "crm")?.n ?? 0 },
    avec: { vendidos: avec.reduce((t, a) => t + a.n, 0), cents: avec.reduce((t, a) => t + a.cents, 0), sessoes: uses.find((u) => u.origin === "avec")?.n ?? 0 },
    byName: [...byName.values()].sort((a, b) => b.crm + b.avec - (a.crm + a.avec) || a.name.localeCompare(b.name, "pt-BR")),
  };
}

/** Item todo em cortesia: não foi faturado, fica fora de profissional, serviço e categoria (aparece em Formas e Exceções). */
const allCourtesy = (i: FinanceItem) => (i.courtesyCents ?? 0) > 0 && i.netCents === 0;

export async function financeItens(r: DayRange): Promise<FinanceItens> {
  const [crm, avec, rep] = await Promise.all([crmItems(r), avecItems(r), commissionReport(r)]);
  const all = [...crm.filter((i) => !allCourtesy(i)), ...avec];
  const pros = new Map<string, FinancePro>();
  for (const i of all) {
    let p = pros.get(i.proKey);
    if (!p) pros.set(i.proKey, p = { key: i.proKey, name: i.professional, crmCents: 0, crmItens: 0, avecCents: 0, avecItens: 0, crmCommissionCents: null, avecCommissionCents: null });
    if (i.origin === "crm") { p.crmCents += i.netCents; p.crmItens++; p.crmCommissionCents = addNull(p.crmCommissionCents, i.commissionCents); }
    else { p.avecCents += i.netCents; p.avecItens++; p.avecCommissionCents = addNull(p.avecCommissionCents, i.commissionCents); }
  }
  // A comissão do CRM por pessoa vem do relatório de comissão (inclui a de assistente, que não tem item próprio): a soma bate com "Comissão no CRM".
  for (const row of rep.rows) {
    let p = pros.get(row.professionalId);
    if (!p) pros.set(row.professionalId, p = { key: row.professionalId, name: row.name, crmCents: 0, crmItens: 0, avecCents: 0, avecItens: 0, crmCommissionCents: null, avecCommissionCents: null });
    p.crmCommissionCents = row.commissionCents;
  }
  const avecCommission = avec.reduce<number | null>((t, i) => addNull(t, i.commissionCents), null);
  return {
    professionals: [...pros.values()].sort((a, b) => b.crmCents + b.avecCents - (a.crmCents + a.avecCents) || a.name.localeCompare(b.name, "pt-BR")),
    services: groupBy(all, (i) => normText(i.item), (i) => i.item, true),
    categories: groupBy(all, (i) => normText(i.category), (i) => tidy(i.category)),
    packages: await packages(r, crm),
    commission: { crmCents: rep.rows.reduce((t, x) => t + x.commissionCents, 0), crmPending: rep.pending, avecCents: avecCommission },
  };
}
