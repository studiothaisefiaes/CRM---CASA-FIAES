import { sql } from "drizzle-orm";
import { rows } from "../common";
import { bucketLabel, salonBuckets, SALON_MIN_DATE, todayBahia, type SalonRange } from "../../../lib/salon-period";
import { can } from "../../../lib/permissions";
import { DRE_EXPENSE_GROUPS, DRE_LABEL, type DreKey } from "../../../lib/dre";
import { REVENUE } from "../salon";
import { UserFacingError } from "../../domain/errors";
import { getMethodAccounts, listBankAccounts } from "../../domain/financeiro/cadastros";
import { financeEntradas } from "./entradas";
import { crmItemsById } from "./itens";

/**
 * Resultado (Fase D, item 28): fluxo de caixa (datas), DRE (competência) e saldo por conta. CRM e Avec em colunas, nunca somados; as
 * despesas só existem no CRM e entram iguais nas duas. Centavos. O liga/desliga (`financeiro_config.resultado`) é da tela, não daqui.
 */
export type FluxoRow = { key: string; label: string; entradasCrmCents: number; entradasAvecCents: number; saidasCents: number; aPagarCents: number };
export type DreLine = { key: DreKey; label: string; crmCents: number | null; avecCents: number | null };
export type ResultadoView = {
  range: SalonRange; fluxo: FluxoRow[];
  dre: DreLine[]; resultado: { crmCents: number; avecCents: number };
  contas: { id: string; name: string; saldoCents: number }[];
  /** Período que não é mês cheio: o DRE usou os meses inteiros que ele toca (a tela mostra este aviso fixo). */
  avisoMeses?: string;
};
export const AVISO_MESES_INTEIROS = "O resultado usa meses inteiros: escolha um mês para comparar receita e despesas.";

const lastDayOf = (day: string) => { const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)); return `${day.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
/**
 * O DRE é por competência do mês (as despesas são do mês inteiro): a receita, o repasse e o custo também contam os meses inteiros que o
 * período toca (M-2). "Mês cheio" = começa no dia 1 e vai até o último dia, ou até hoje (o mês ainda não acabou: "Este mês", "Este ano").
 */
export function dreMonths(range: SalonRange, now: Date): { from: string; to: string; inteiro: boolean } {
  const from = `${range.from.slice(0, 7)}-01`, to = lastDayOf(range.to);
  const inteiro = range.from === from && (range.to === to || range.to >= todayBahia(now));
  return { from, to, inteiro };
}

/** O Resultado é dado de dinheiro: a tela e o Excel chamam isto antes de `loadResultado` (mesma regra do Financeiro: `valores.ver`). */
export function assertCanSeeResultado(perms: readonly string[] | null | undefined): void {
  if (!can(perms, "valores.ver")) throw new UserFacingError("Você não tem permissão para ver o Resultado.");
}

const KIND_LINE: Record<string, DreKey> = { servico: "receita_servicos", produto: "receita_produtos", pacote_venda: "receita_pacotes" };
const n = (v: unknown) => Number(v ?? 0);

export async function loadResultado(range: SalonRange, now: Date = new Date()): Promise<ResultadoView> {
  const { from, to } = range;
  const meses = dreMonths(range, now);
  const [dFrom, dTo] = [meses.from, meses.to];
  const dre = new Map<DreKey, { crm: number | null; avec: number | null }>();
  const add = (k: DreKey, side: "crm" | "avec", v: number) => { const l = dre.get(k) ?? { crm: 0, avec: 0 }; l[side] = (l[side] ?? 0) + v; dre.set(k, l); };
  for (const k of ["receita_servicos", "receita_produtos", "receita_pacotes", "repasse_profissionais", ...DRE_EXPENSE_GROUPS] as DreKey[]) dre.set(k, { crm: 0, avec: 0 });
  // Taxas de cartão: a Fase A preenche a coluna CRM (taxa gravada por pagamento); sem ela, os dois lados ficam null ("—" na tela).
  dre.set("taxas_cartao", { crm: null, avec: null });
  // Custo dos produtos só existe no CRM (o Avec não traz o custo).
  dre.set("custo_produtos", { crm: 0, avec: null });

  const [crmRows, crmFallback, avecRows, custo, desp, entradas, pagas, aPagar, accounts, methodMap, allIn] = await Promise.all([
    rows<{ id: string; kind: string; net: number | null; commission: number | null }>(sql`
      select ci.id, ci.kind, ci.net_cents as net, ci.commission_cents as commission
      from comanda_items ci join comandas c on c.id = ci.comanda_id
      where c.status = 'fechada' and c.day between ${dFrom}::date and ${dTo}::date and ci.cancelled_at is null`),
    crmItemsById({ from: dFrom, to: dTo }),
    rows<{ kind: string; cents: number; commission: number }>(sql`
      select si.kind, coalesce(sum(${REVENUE()}), 0)::float8 as cents, coalesce(sum(si.commission_cents), 0)::float8 as commission
      from sales_items si where si.sold_on between ${dFrom}::date and ${dTo}::date group by si.kind`),
    rows<{ cents: number }>(sql`
      select coalesce(sum(-sm.delta_qty * sm.unit_cost_cents), 0)::float8 as cents
      from stock_movements sm join comanda_items ci on ci.id = sm.comanda_item_id join comandas c on c.id = ci.comanda_id
      where sm.reason = 'venda' and sm.cancelled_at is null and c.status = 'fechada' and c.day between ${dFrom}::date and ${dTo}::date`),
    rows<{ grp: string; cents: number }>(sql`
      select fc.dre_group as grp, sum(e.amount_cents)::float8 as cents from expenses e join finance_categories fc on fc.id = e.category_id
      where e.cancelled_at is null and e.competence between ${dFrom}::date and ${dTo}::date group by 1`),
    financeEntradas(range),
    rows<{ day: string; cents: number }>(sql`
      select e.paid_on::text as day, sum(coalesce(e.paid_cents, e.amount_cents))::float8 as cents from expenses e
      where e.cancelled_at is null and e.paid_on between ${from}::date and ${to}::date group by 1`),
    rows<{ day: string; cents: number }>(sql`
      select e.due_on::text as day, sum(e.amount_cents)::float8 as cents from expenses e
      where e.cancelled_at is null and e.paid_on is null and e.due_on between ${from}::date and ${to}::date group by 1`),
    listBankAccounts(),
    getMethodAccounts(),
    financeEntradas({ from: SALON_MIN_DATE, to, grain: "mes" }),
  ]);

  // CRM: net_cents gravado no fechamento; item fechado antes dele (null) usa o valor que Relatórios › Financeiro já usa (`crmItems`).
  const fallback = new Map(crmFallback.map((i) => [i.id, i.netCents]));
  for (const i of crmRows) {
    const line = KIND_LINE[i.kind];
    if (line) add(line, "crm", i.net ?? fallback.get(i.id) ?? 0);
    add("repasse_profissionais", "crm", i.commission ?? 0);
  }
  for (const a of avecRows) {
    const line = KIND_LINE[a.kind];
    if (line) add(line, "avec", n(a.cents));
    add("repasse_profissionais", "avec", n(a.commission));
  }
  add("custo_produtos", "crm", n(custo[0]?.cents));
  for (const d of desp) { add(d.grp as DreKey, "crm", n(d.cents)); add(d.grp as DreKey, "avec", n(d.cents)); }

  const order: DreKey[] = ["receita_servicos", "receita_produtos", "receita_pacotes", "repasse_profissionais", "taxas_cartao", "custo_produtos", ...DRE_EXPENSE_GROUPS];
  const lines: DreLine[] = order.map((key) => ({ key, label: DRE_LABEL[key], crmCents: dre.get(key)!.crm, avecCents: dre.get(key)!.avec }));
  const receitas = new Set<DreKey>(["receita_servicos", "receita_produtos", "receita_pacotes"]);
  const total = (side: "crmCents" | "avecCents") => lines.reduce((t, l) => t + (receitas.has(l.key) ? 1 : -1) * (l[side] ?? 0), 0);

  const bucket = (day: string) => (range.grain === "dia" ? day : day.slice(0, 7));
  const out = new Map(entradas.days.map((d) => [d.key, { key: d.key, label: d.label || bucketLabel(d.key), entradasCrmCents: d.crmCents, entradasAvecCents: d.avecCents, saidasCents: 0, aPagarCents: 0 }]));
  for (const k of salonBuckets(range)) if (!out.has(k)) out.set(k, { key: k, label: bucketLabel(k), entradasCrmCents: 0, entradasAvecCents: 0, saidasCents: 0, aPagarCents: 0 });
  for (const p of pagas) { const r = out.get(bucket(p.day)); if (r) r.saidasCents += n(p.cents); }
  for (const p of aPagar) { const r = out.get(bucket(p.day)); if (r) r.aPagarCents += n(p.cents); }

  // Saldo por conta: abertura + entradas do CRM das formas ligadas à conta (desde sempre até o fim do período) − despesas pagas por ela.
  const paidBy = new Map((await rows<{ id: string; cents: number }>(sql`
    select e.bank_account_id as id, sum(coalesce(e.paid_cents, e.amount_cents))::float8 as cents from expenses e
    where e.cancelled_at is null and e.paid_on is not null and e.paid_on <= ${to}::date and e.bank_account_id is not null group by 1`)).map((r) => [r.id, n(r.cents)]));
  const crmByMethod = new Map(allIn.methods.filter((m) => m.revenue && m.key !== "credito_cliente").map((m) => [m.key, m.crmCents]));
  const contas = accounts.filter((a) => a.active).map((a) => {
    const entrou = Object.entries(methodMap).filter(([, acc]) => acc === a.id).reduce((t, [m]) => t + (crmByMethod.get(m) ?? 0), 0);
    return { id: a.id, name: a.name, saldoCents: a.openingCents + entrou - (paidBy.get(a.id) ?? 0) };
  });

  return { range, fluxo: [...out.values()], dre: lines, resultado: { crmCents: total("crmCents"), avecCents: total("avecCents") }, contas, ...(meses.inteiro ? {} : { avisoMeses: AVISO_MESES_INTEIROS }) };
}
