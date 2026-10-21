import { sql } from "drizzle-orm";
import { rows } from "../common";
import { bucketLabel, salonBuckets, type SalonRange } from "../../../lib/salon-period";
import { isRevenue, methodKey, methodLabel, methodRank } from "./methods";
import { differencesOf, type DrawerMethod } from "../../../lib/comanda-math";

/**
 * Financeiro, o dinheiro que entrou (plano 4): o caixa do CRM e os pagamentos do Avec, os dois pela data do PAGAMENTO, lado a lado e
 * nunca somados. Centavos. Cortesia aparece nas formas, fora das entradas. O lado do CRM conta como o Caixa (QA r58, C-2): o pagamento
 * parcial de comanda ainda aberta já está na gaveta e entra; o crédito da cliente usado não entra (o troco guardado já entrou como dinheiro).
 */
export type FinRange = Pick<SalonRange, "from" | "to" | "grain">;
/** `taxasCents`: taxa do cartão gravada nos pagamentos do CRM; o Avec não manda a taxa (0, e o líquido é igual às entradas). */
export type Side = { entradasCents: number; comandas: number; ticketCents: number | null; taxasCents: number; liquidoCents: number };
export type FinanceDay = { key: string; label: string; crmCents: number; avecCents: number };
export type FinanceMethod = { key: string; label: string; revenue: boolean; crmCents: number; crmFeeCents: number; crmN: number; avecCents: number; avecN: number };
export type FinanceCashier = {
  sessionId: string | null; day: string | null; userName: string; openedAt: string | null; closedAt: string | null;
  status: "aberto" | "fechado" | null; openingCents: number; entradasCents: number; comandas: number; differenceCents: number | null;
  /** Fechado: contado − esperado das formas com diferença (QA r58, C-1: a soma pode dar zero com dinheiro faltando). */
  differences: { method: DrawerMethod; cents: number }[];
};
export type FinanceEntradas = { crm: Side; avec: Side; days: FinanceDay[]; methods: FinanceMethod[]; cashiers: FinanceCashier[] };

export const SEM_CAIXA = "Sem caixa aberto";
const side = (cents: number, comandas: number, taxas = 0): Side => ({ entradasCents: cents, comandas, ticketCents: comandas ? Math.round(cents / comandas) : null, taxasCents: taxas, liquidoCents: cents - taxas });

type CrmPay = { comandaId: string; day: string; sessionId: string | null; method: string | null; v: number | null; fee: number; n: number };

/**
 * Pagamentos vivos do período, pelo dia do pagamento em Salvador (como o Caixa, `paymentsByDay`), de comandas não canceladas, inclusive a
 * aberta com pagamento parcial; uma linha por comanda, dia, caixa e forma. Caixa por pessoa (plano 3): o pagamento é do caixa de quem
 * RECEBEU (`comanda_payments.cash_session_id`) e já vem líquido do troco devolvido dele, como no fechamento do caixa.
 */
async function crmPays(r: FinRange): Promise<CrmPay[]> {
  return rows<CrmPay>(sql`
    select c.id as "comandaId", to_char((cp.created_at at time zone 'America/Bahia')::date, 'YYYY-MM-DD') as day, cp.cash_session_id as "sessionId",
      cp.method, sum(cp.value_cents - cp.change_cents)::int as v, coalesce(sum(cp.fee_cents), 0)::int as fee, count(cp.id)::int as n
    from comanda_payments cp join comandas c on c.id = cp.comanda_id
    where cp.cancelled_at is null and c.status <> 'cancelada'
      and (cp.created_at at time zone 'America/Bahia')::date between ${r.from}::date and ${r.to}::date
    group by c.id, 2, cp.cash_session_id, cp.method`);
}
/** Do lado do CRM, entra o que o Caixa conta: crédito da cliente usado não é dinheiro novo. O Avec segue o Salão. */
const crmRevenue = (key: string) => isRevenue(key) && key !== "credito_cliente";

type AvecPay = { day: string; comandaKey: string; method: string | null; v: number };
async function avecPays(r: FinRange): Promise<AvecPay[]> {
  return rows<AvecPay>(sql`
    select coalesce(sp.paid_on, sp.comanda_on)::text as day, coalesce(sp.comanda_on::text, '') || '|' || coalesce(sp.comanda, sp.id::text) as "comandaKey",
      sp.method, sp.value_cents as v
    from sales_payments sp where coalesce(sp.paid_on, sp.comanda_on) between ${r.from}::date and ${r.to}::date`);
}

type Session = { id: string; day: string; userName: string; openedAt: Date; closedAt: Date | null; status: "aberto" | "fechado"; opening: number; diff: number | null;
  expected: Record<string, number> | null; counted: Record<string, number> | null };
async function sessions(r: FinRange, ids: string[]): Promise<Session[]> {
  return rows<Session>(sql`
    select cs.id, cs.day::text as day, coalesce(initcap(lower(u.signature)), u.name) as "userName", cs.opened_at as "openedAt", cs.closed_at as "closedAt",
      cs.status, cs.opening_cents as opening, cs.difference_cents as diff, cs.expected, cs.counted
    from cash_sessions cs join users u on u.id = cs.opened_by
    where (cs.day between ${r.from}::date and ${r.to}::date) ${ids.length ? sql`or cs.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``}
    order by cs.day, cs.opened_at`);
}

export async function financeEntradas(r: FinRange): Promise<FinanceEntradas> {
  const [crm, avec] = await Promise.all([crmPays(r), avecPays(r)]);
  const bucket = (day: string) => (r.grain === "dia" ? day : day.slice(0, 7));
  const days = new Map(salonBuckets(r).map((k) => [k, { key: k, label: bucketLabel(k), crmCents: 0, avecCents: 0 }]));
  const methods = new Map<string, FinanceMethod>();
  const method = (key: string) => {
    let m = methods.get(key);
    if (!m) methods.set(key, m = { key, label: methodLabel(key), revenue: isRevenue(key), crmCents: 0, crmFeeCents: 0, crmN: 0, avecCents: 0, avecN: 0 });
    return m;
  };

  // CRM: o troco devolvido já saiu do dinheiro de cada pagamento (não é venda), como no fechamento do caixa.
  const comandaIds = new Set<string>();
  const bySession = new Map<string | null, { cents: number; comandas: Set<string> }>();
  let crmCents = 0, crmTaxas = 0;
  // Comanda conta quando teve pagamento (como no Avec): a fechada só com sessão de pacote, sem pagamento, não entra no ticket nem no caixa.
  for (const p of crm) {
    if (!p.method) continue;
    comandaIds.add(p.comandaId);
    const sess = bySession.get(p.sessionId) ?? { cents: 0, comandas: new Set<string>() };
    bySession.set(p.sessionId, sess);
    sess.comandas.add(p.comandaId);
    const key = methodKey(p.method);
    const value = p.v ?? 0;
    const m = method(key);
    m.crmCents += value; m.crmFeeCents += p.fee; m.crmN += p.n;
    if (!crmRevenue(key)) continue;
    crmCents += value; crmTaxas += p.fee; sess.cents += value;
    const d = days.get(bucket(p.day)); if (d) d.crmCents += value;
  }

  const avecComandas = new Set<string>();
  let avecCents = 0;
  for (const p of avec) {
    const m = method(methodKey(p.method));
    m.avecCents += p.v; m.avecN += 1;
    if (!m.revenue) continue;
    avecComandas.add(p.comandaKey);
    avecCents += p.v;
    const d = days.get(bucket(p.day)); if (d) d.avecCents += p.v;
  }

  const sess = await sessions(r, [...bySession.keys()].filter((k): k is string => !!k));
  const cashiers: FinanceCashier[] = sess.map((x) => ({
    sessionId: x.id, day: x.day, userName: x.userName, openedAt: new Date(x.openedAt).toISOString(), closedAt: x.closedAt ? new Date(x.closedAt).toISOString() : null,
    status: x.status, openingCents: x.opening, entradasCents: bySession.get(x.id)?.cents ?? 0, comandas: bySession.get(x.id)?.comandas.size ?? 0, differenceCents: x.diff,
    differences: x.status === "fechado" ? differencesOf(x.expected, x.counted) : [],
  }));
  const loose = bySession.get(null);
  if (loose) cashiers.push({ sessionId: null, day: null, userName: SEM_CAIXA, openedAt: null, closedAt: null, status: null, openingCents: 0, entradasCents: loose.cents, comandas: loose.comandas.size, differenceCents: null, differences: [] });

  return {
    crm: side(crmCents, comandaIds.size, crmTaxas), avec: side(avecCents, avecComandas.size), days: [...days.values()],
    methods: [...methods.values()].sort((a, b) => methodRank(a.key) - methodRank(b.key) || a.label.localeCompare(b.label, "pt-BR")),
    cashiers,
  };
}
