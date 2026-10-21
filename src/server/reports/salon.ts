import { GENERIC_NAME_RE } from "@/lib/generic-client";
import { sql, type SQL } from "drizzle-orm";
import { periodWindow, rows, type ReportFilter } from "./common";
import { bucketLabel, salonBuckets, todayBahia, type SalonRange } from "../../lib/salon-period";
import { can } from "../../lib/permissions";
import { SALES_ITEMS, SALES_PAYMENTS } from "./vendas-unificadas";
// Horário além de FUTURE_MAX_DAYS à frente é data errada do Avec (2923, 4676): a mesma régua do funil do Lote 1C.
import { FUTURE_MAX_DAYS } from "../domain/avec/funnel-sync";

/**
 * Painel "Salão" (Lote 3): o que o dono de salão olha, lido das comandas (`sales_items`), dos pagamentos (`sales_payments`), dos horários
 * (`appointments`) e das conversas (`deals`). Avec hoje; a comanda do CRM (Lote 6C) entra nas mesmas tabelas. Dinheiro em centavos.
 * Quem vê o quê é decidido em `loadSalon` (sem "ver valores", todo valor sai como null).
 */

/** Período em dias de Salvador, inclusivo ("AAAA-MM-DD"). */
export type DayRange = { from: string; to: string };

/**
 * Valor de um item (centavos): total = valor − desconto (Lote 0: o "Valor" do Avec já é o total da linha). Sessão de pacote (`from_package`)
 * vale 0: o dinheiro entrou quando o pacote foi vendido. A conferência por ano (`yearlyCheck`) mostra as duas contas.
 */
export const REVENUE = (a = "si"): SQL =>
  sql.raw(`(case when ${a}.from_package then 0 else coalesce(${a}.total_cents, ${a}.value_cents - coalesce(${a}.discount_cents, 0), 0) end)`);
/** Uma comanda = dia + número (o número reinicia no Avec); item sem número conta como comanda própria. */
export const COMANDA_KEY = (a = "si"): SQL => sql.raw(`(${a}.sold_on::text || '|' || coalesce(${a}.comanda, ${a}.id::text))`);
/** Comandas com dinheiro: as que têm algum item que não é sessão de pacote. */
const COMANDAS = (a = "si"): SQL => sql`count(distinct ${COMANDA_KEY(a)}) filter (where not ${sql.raw(a)}.from_package)`;
const inDays = (col: string, r: DayRange): SQL => sql`${sql.raw(col)} between ${r.from}::date and ${r.to}::date`;
const num = (v: unknown) => Number(v ?? 0);
const ticket = (cents: number, comandas: number) => (comandas ? Math.round(cents / comandas) : null);

export type RevenueTotals = { cents: number; comandas: number; itens: number; ticketCents: number | null };

export async function revenueTotals(r: DayRange): Promise<RevenueTotals> {
  const [x] = await rows<{ cents: number; comandas: number; itens: number }>(sql`
    select coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas, count(*)::int as itens
    from ${SALES_ITEMS} si where ${inDays("si.sold_on", r)}`);
  const cents = num(x?.cents), comandas = x?.comandas ?? 0;
  return { cents, comandas, itens: x?.itens ?? 0, ticketCents: ticket(cents, comandas) };
}

export type SalonRevenue = RevenueTotals & { previous: RevenueTotals; series: { key: string; cents: number; comandas: number }[] };

/** Faturamento do período, o do período anterior e as barras (por dia ou por mês, sem buracos). */
export async function salonRevenue(r: SalonRange): Promise<SalonRevenue> {
  const fmt = r.grain === "dia" ? "YYYY-MM-DD" : "YYYY-MM";
  const [cur, previous, s] = await Promise.all([
    revenueTotals(r), revenueTotals({ from: r.prevFrom, to: r.prevTo }),
    rows<{ k: string; cents: number; comandas: number }>(sql`
      select to_char(si.sold_on, ${fmt}) as k, coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas
      from ${SALES_ITEMS} si where ${inDays("si.sold_on", r)} group by 1`),
  ]);
  const by = new Map(s.map((x) => [x.k, x]));
  return { ...cur, previous, series: salonBuckets(r).map((k) => ({ key: k, cents: num(by.get(k)?.cents), comandas: by.get(k)?.comandas ?? 0 })) };
}

/** Até quando vão os dados do Avec (a última venda importada): a legenda "fonte: Avec até 14/10". */
export async function avecUntil(): Promise<string | null> {
  const [x] = await rows<{ d: string | null }>(sql`select max(sold_on)::text as d from sales_items where origin = 'avec'`);
  return x?.d ?? null;
}

export type ProfessionalRow = { key: string; name: string; cents: number; comandas: number; itens: number; ticketCents: number | null; commissionCents: number | null };

/** Por profissional: o cadastro; sem cadastro, o nome escrito no Avec; sem nada, "Sem profissional". `byCount`: em ordem de comandas. */
export async function salonByProfessional(r: DayRange, opts: { byCount?: boolean } = {}): Promise<ProfessionalRow[]> {
  const x = await rows<{ key: string; name: string; cents: number; comandas: number; itens: number; commission: number | null }>(sql`
    select coalesce(si.professional_id::text, 'nome:' || lower(nullif(trim(si.professional_name), '')), 'sem') as key,
      coalesce(max(p.name), max(nullif(trim(si.professional_name), '')), 'Sem profissional') as name,
      coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas, count(*)::int as itens,
      sum(si.commission_cents)::float8 as commission
    from ${SALES_ITEMS} si left join professionals p on p.id = si.professional_id
    where ${inDays("si.sold_on", r)} group by 1
    order by ${opts.byCount ? sql`comandas desc, cents desc` : sql`cents desc, comandas desc`}, name`);
  return x.map((p) => ({
    key: p.key, name: p.name, cents: num(p.cents), comandas: p.comandas, itens: p.itens, ticketCents: ticket(num(p.cents), p.comandas),
    commissionCents: p.commission == null ? null : Math.round(num(p.commission)),
  }));
}

export const SERVICE_TOP = 15;
export type SalonServices = {
  items: { item: string; category: string | null; n: number; cents: number }[];
  /** O que ficou fora dos 15: quantos serviços, quantos itens e quanto. */ otherItems: { count: number; n: number; cents: number };
  categories: { category: string; n: number; cents: number }[];
};

export async function salonByService(r: DayRange, opts: { byCount?: boolean } = {}): Promise<SalonServices> {
  const order = opts.byCount ? sql`n desc, cents desc` : sql`cents desc, n desc`;
  const [items, categories] = await Promise.all([
    rows<{ item: string; category: string | null; n: number; cents: number }>(sql`
      select si.item, max(si.category) as category, count(*)::int as n, coalesce(sum(${REVENUE()}), 0)::float8 as cents
      from ${SALES_ITEMS} si where ${inDays("si.sold_on", r)} group by si.item order by ${order}, si.item`),
    rows<{ category: string; n: number; cents: number }>(sql`
      select coalesce(nullif(trim(si.category), ''), 'Sem categoria') as category, count(*)::int as n, coalesce(sum(${REVENUE()}), 0)::float8 as cents
      from ${SALES_ITEMS} si where ${inDays("si.sold_on", r)} group by 1 order by ${order}, 1`),
  ]);
  const top = items.slice(0, SERVICE_TOP), rest = items.slice(SERVICE_TOP);
  return {
    items: top.map((x) => ({ item: x.item, category: x.category, n: x.n, cents: num(x.cents) })),
    otherItems: { count: rest.length, n: rest.reduce((a, x) => a + x.n, 0), cents: rest.reduce((a, x) => a + num(x.cents), 0) },
    categories: categories.map((x) => ({ category: x.category, n: x.n, cents: num(x.cents) })),
  };
}

export type PaymentRow = { method: string; n: number; cents: number };

/** Pagamentos de comanda pela data do pagamento (sem ela, a da comanda). "Cartão de Crédito (Visa)" conta como "Cartão de Crédito". */
export async function salonPayments(r: DayRange, opts: { byCount?: boolean } = {}): Promise<PaymentRow[]> {
  const x = await rows<{ method: string; n: number; cents: number }>(sql`
    select coalesce(nullif(split_part(trim(sp.method), ' (', 1), ''), 'Não informada') as method, count(*)::int as n,
      coalesce(sum(sp.value_cents), 0)::float8 as cents
    from ${SALES_PAYMENTS} sp where coalesce(sp.paid_on, sp.comanda_on) between ${r.from}::date and ${r.to}::date
    group by 1 order by ${opts.byCount ? sql`n desc, cents desc` : sql`cents desc, n desc`}, 1`);
  return x.map((p) => ({ method: p.method, n: p.n, cents: num(p.cents) }));
}

export type YearCheck = { ano: number; faturamentoCents: number; comPacoteCents: number; pagamentosCents: number; diferencaPct: number | null };

/** Conferência da spec ("faturamento por ano bate com os pagamentos, diferença menor que 5%"): por ano, sem e com as sessões de pacote. */
export async function yearlyCheck(): Promise<YearCheck[]> {
  const r = await rows<{ ano: number; fat: number; com: number; pag: number }>(sql`
    with f as (
        select extract(year from si.sold_on)::int as ano, sum(${REVENUE()})::float8 as fat,
          sum(coalesce(si.total_cents, si.value_cents - coalesce(si.discount_cents, 0), 0))::float8 as com
        from ${SALES_ITEMS} si group by 1),
      p as (
        select extract(year from coalesce(sp.paid_on, sp.comanda_on))::int as ano, sum(sp.value_cents)::float8 as pag
        from ${SALES_PAYMENTS} sp where coalesce(sp.paid_on, sp.comanda_on) is not null group by 1)
    select coalesce(f.ano, p.ano) as ano, coalesce(f.fat, 0)::float8 as fat, coalesce(f.com, 0)::float8 as com, coalesce(p.pag, 0)::float8 as pag
    from f full join p on p.ano = f.ano order by 1`);
  return r.map((x) => ({
    ano: x.ano, faturamentoCents: num(x.fat), comPacoteCents: num(x.com), pagamentosCents: num(x.pag),
    diferencaPct: num(x.pag) > 0 ? Math.round(((num(x.fat) - num(x.pag)) / num(x.pag)) * 1000) / 10 : null,
  }));
}

/* ───────────── Clientes, comparecimento e funil ───────────── */

/** A cliente de um item: o contato; sem contato, o nome (minúsculo, sem espaço nas pontas). */
const CLIENT_KEY = sql.raw(`coalesce(si.contact_id::text, 'nome:' || lower(nullif(trim(si.client_name), '')))`);
const localDay = (col: string): SQL => sql.raw(`((${col}) at time zone 'America/Bahia')::date`);

export type ClientsMix = { novas: number; recorrentes: number };

async function clientsMix(r: DayRange): Promise<ClientsMix> {
  const [x] = await rows<ClientsMix>(sql`
    with firsts as (select ${CLIENT_KEY} as k, min(si.sold_on) as first_day from ${SALES_ITEMS} si where ${CLIENT_KEY} is not null group by 1),
      inper as (select distinct ${CLIENT_KEY} as k from ${SALES_ITEMS} si where ${inDays("si.sold_on", r)} and ${CLIENT_KEY} is not null)
    select count(*) filter (where f.first_day >= ${r.from}::date)::int as novas, count(*) filter (where f.first_day < ${r.from}::date)::int as recorrentes
    from inper i join firsts f on f.k = i.k`);
  return { novas: x?.novas ?? 0, recorrentes: x?.recorrentes ?? 0 };
}

/** Quem comprou no período: nova (a primeira compra dela em todo o histórico foi no período) ou recorrente. Com o período anterior. */
export async function salonClients(r: SalonRange): Promise<ClientsMix & { previous: ClientsMix }> {
  const [cur, previous] = await Promise.all([clientsMix(r), clientsMix({ from: r.prevFrom, to: r.prevTo })]);
  return { ...cur, previous };
}

export type AttendanceCounts = { compareceu: number; faltou: number; cancelado: number; semDesfecho: number };
export type AttendanceRow = AttendanceCounts & { key: string; name: string };
export type NoOutcomeItem = { id: string; startsAt: string; clientName: string | null; contactId: string | null; professional: string | null; service: string };
export type SalonAttendance = { rows: AttendanceRow[]; total: AttendanceCounts; noOutcome: { n: number; items: NoOutcomeItem[] } };
export const NO_OUTCOME_LIST = 30;

/** Horários do período por profissional (lista de espera não entra) e os que já passaram sem desfecho (ainda agendado ou confirmado). */
export async function salonAttendance(r: DayRange, now = new Date()): Promise<SalonAttendance> {
  const pending = sql`a.status in ('agendado', 'confirmado', 'conferir') and a.starts_at < ${now.toISOString()}::timestamptz`;
  // A CLIENTE PADRÃO do Avec (cliente genérica, sem ficha) não entra nos números da agenda (17/10).
  const inPeriod = sql`${localDay("a.starts_at")} between ${r.from}::date and ${r.to}::date and not (a.contact_id is null and coalesce(a.client_name, '') ~* ${GENERIC_NAME_RE})`;
  const [byPro, list] = await Promise.all([
    rows<AttendanceRow>(sql`
      select coalesce(a.professional_id::text, 'sem') as key, coalesce(max(p.name), 'Sem profissional') as name,
        count(*) filter (where a.status = 'compareceu')::int as compareceu, count(*) filter (where a.status = 'faltou')::int as faltou,
        count(*) filter (where a.status = 'cancelado')::int as cancelado, count(*) filter (where ${pending})::int as "semDesfecho"
      from appointments a left join professionals p on p.id = a.professional_id
      where a.status <> 'espera' and ${inPeriod}
      group by 1 order by compareceu desc, name`),
    rows<{ id: string; startsAt: Date; clientName: string | null; contactId: string | null; professional: string | null; service: string }>(sql`
      select a.id, a.starts_at as "startsAt", coalesce(c.name, a.client_name) as "clientName", a.contact_id as "contactId", p.name as professional,
        a.service_label as service
      from appointments a left join professionals p on p.id = a.professional_id left join contacts c on c.id = a.contact_id
      where ${pending} and ${inPeriod} order by a.starts_at desc limit ${NO_OUTCOME_LIST}`),
  ]);
  const total = byPro.reduce<AttendanceCounts>((t, x) => ({
    compareceu: t.compareceu + x.compareceu, faltou: t.faltou + x.faltou, cancelado: t.cancelado + x.cancelado, semDesfecho: t.semDesfecho + x.semDesfecho,
  }), { compareceu: 0, faltou: 0, cancelado: 0, semDesfecho: 0 });
  return { rows: byPro, total, noOutcome: { n: total.semDesfecho, items: list.map((x) => ({ ...x, startsAt: new Date(x.startsAt).toISOString() })) } };
}

export type SalonFunnel = { conversas: number; comHorario: number; compareceram: number; compraram: number };

/**
 * Conversas que começaram no período (sem "Não é cliente" e sem lead arquivado) e o que veio depois, cada passo por conta própria:
 * quem passou na recepção compra sem horário marcado. Horário além de FUTURE_MAX_DAYS (data errada do Avec: 2923, 4676) não conta.
 */
export async function salonFunnel(r: DayRange, now = new Date()): Promise<SalonFunnel> {
  const limit = new Date(now.getTime() + FUTURE_MAX_DAYS * 86_400_000).toISOString();
  const [x] = await rows<SalonFunnel>(sql`
    with conv as (
      select d.id, d.contact_id, d.created_at from deals d join contacts c on c.id = d.contact_id
      where d.archived_at is null and c.kind not in ('fornecedor', 'spam') and ${localDay("d.created_at")} between ${r.from}::date and ${r.to}::date)
    select count(*)::int as conversas,
      count(*) filter (where exists (select 1 from appointments a where a.contact_id = conv.contact_id and a.status <> 'espera'
        and a.starts_at >= conv.created_at and a.starts_at <= ${limit}::timestamptz))::int as "comHorario",
      count(*) filter (where exists (select 1 from appointments a where a.contact_id = conv.contact_id and a.status = 'compareceu'
        and a.starts_at >= conv.created_at and a.starts_at <= ${limit}::timestamptz))::int as compareceram,
      count(*) filter (where exists (select 1 from ${SALES_ITEMS} s where s.contact_id = conv.contact_id
        and s.sold_on >= ${localDay("conv.created_at")}))::int as compraram
    from conv`);
  return x ?? { conversas: 0, comHorario: 0, compareceram: 0, compraram: 0 };
}

/* ───────────── O painel para a tela ───────────── */

export type SalonView = {
  range: SalonRange; avecUntil: string | null;
  /** Pode ver valores (`valores.ver`). Sem isso, todo campo em centavos vem null. */ money: boolean;
  revenue: {
    cents: number | null; prevCents: number | null; comandas: number; prevComandas: number; ticketCents: number | null; prevTicketCents: number | null;
    series: { key: string; label: string; cents: number | null; comandas: number }[];
  };
  professionals: { key: string; name: string; comandas: number; itens: number; cents: number | null; ticketCents: number | null; commissionCents: number | null }[];
  services: {
    items: { item: string; category: string | null; n: number; cents: number | null }[];
    otherItems: { count: number; n: number; cents: number | null };
    categories: { category: string; n: number; cents: number | null }[];
  };
  payments: { method: string; n: number; cents: number | null }[];
  clients: ClientsMix & { previous: ClientsMix };
  attendance: SalonAttendance;
  funnel: SalonFunnel;
};

/**
 * O painel inteiro. Sem "ver valores", todo valor em centavos vai como null (o dado nem chega à tela) e as listas saem em ordem de
 * quantidade: a ordem por faturamento entregaria quem fatura mais.
 */
export async function loadSalon(user: { perms: readonly string[] }, range: SalonRange, now = new Date()): Promise<SalonView> {
  const money = can(user.perms, "valores.ver");
  const byCount = !money;
  const [rev, pros, svc, pays, clients, attendance, funnel, until] = await Promise.all([
    salonRevenue(range), salonByProfessional(range, { byCount }), salonByService(range, { byCount }), salonPayments(range, { byCount }),
    salonClients(range), salonAttendance(range, now), salonFunnel(range, now), avecUntil(),
  ]);
  const m = (v: number | null) => (money ? v : null);
  return {
    range, avecUntil: until, money,
    revenue: {
      cents: m(rev.cents), prevCents: m(rev.previous.cents), comandas: rev.comandas, prevComandas: rev.previous.comandas,
      ticketCents: m(rev.ticketCents), prevTicketCents: m(rev.previous.ticketCents),
      series: rev.series.map((s) => ({ key: s.key, label: bucketLabel(s.key), cents: m(s.cents), comandas: s.comandas })),
    },
    professionals: pros.map((p) => ({ key: p.key, name: p.name, comandas: p.comandas, itens: p.itens, cents: m(p.cents), ticketCents: m(p.ticketCents), commissionCents: m(p.commissionCents) })),
    services: {
      items: svc.items.map((s) => ({ ...s, cents: m(s.cents) })),
      otherItems: { ...svc.otherItems, cents: m(svc.otherItems.cents) },
      categories: svc.categories.map((c) => ({ ...c, cents: m(c.cents) })),
    },
    payments: pays.map((p) => ({ ...p, cents: m(p.cents) })),
    clients, attendance, funnel,
  };
}

/* ───────────── Financeiro (aba Análise) ───────────── */

export type SalonFinance = { from: string; to: string; avecUntil: string | null; faturadoCents: number; comandas: number; recebidoCents: number; byMethod: PaymentRow[] };

/** O salão no período da tela da Análise (hoje, 7 dias, mês, ano), em dias de Salvador: faturado, comandas e recebido por forma. */
export async function salonFinance(f: Pick<ReportFilter, "period" | "now">): Promise<SalonFinance> {
  const w = periodWindow(f);
  const r: DayRange = { from: todayBahia(w.from), to: todayBahia(w.to) };
  const [rev, pays, until] = await Promise.all([revenueTotals(r), salonPayments(r), avecUntil()]);
  return { ...r, avecUntil: until, faturadoCents: rev.cents, comandas: rev.comandas, recebidoCents: pays.reduce((a, p) => a + p.cents, 0), byMethod: pays };
}
