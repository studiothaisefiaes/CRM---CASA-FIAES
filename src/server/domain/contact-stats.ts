import { sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { SOURCE_EXPR } from "../reports/common";
// Total gasto e visitas pagas: o Avec e as comandas fechadas do CRM, sem somar o mesmo dia duas vezes (QA r66, I-1).
import { SALES_ITEMS } from "../reports/vendas-unificadas";
import { NOT_IDENTIFIED } from "../../lib/source-kinds";
import { MIN_VISITS_FOR_RHYTHM, PREFERRED_MIN_SERVICES, PREFERRED_MIN_SHARE } from "../../lib/client-rhythm";

/**
 * A visão por contato (Lote 2): recalcula `contact_stats` INTEIRA a partir do Avec (horários, comandas, pagamentos) e do CRM.
 * Roda depois de cada importação do Avec e toda noite (worker). Só escreve nesta tabela derivada; nunca envia nada.
 * Numa transação só: quem lê vê a versão anterior até o fim; a trava faz duas recalculadas ao mesmo tempo esperarem uma a outra.
 */
const TZ = "America/Bahia";
const LOCK_KEY = 2_026_101_502; // pg_advisory_xact_lock só desta recalculada
/** "CLIENTE GILVAN" no "Como conheceu": a Casa usava o campo para guardar a profissional (parâmetros, não texto na SQL: sem escapes). */
const CLIENTE_RE = "^\\s*cliente\\s+\\S";
const CLIENTE_PREFIX_RE = "^\\s*cliente\\s+";
const DEBT_RE = "d[íiÍI]vida";
const CREDIT_RE = "cr[éeÉE]dito\\s+cliente";

export type RefreshResult = { contatos: number; comVisita: number; ms: number };

export async function refreshContactStatsTx(tx: Tx, now: Date = new Date()): Promise<RefreshResult> {
  const t0 = Date.now();
  const at = now.toISOString();
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
  await tx.execute(sql`delete from contact_stats`);
  await tx.execute(sql`
    with
    hoje as (select (${at}::timestamptz at time zone ${TZ})::date as dia),
    visit_days as (
      select a.contact_id, (a.starts_at at time zone ${TZ})::date as day
        from appointments a
       where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${at}::timestamptz
      union
      select s.contact_id, s.sold_on
        from sales_items s, hoje
       where s.contact_id is not null and s.sold_on <= hoje.dia
      union
      select d.contact_id, (coalesce(d.attendance_at, d.scheduled_at) at time zone ${TZ})::date
        from deals d
       where d.attendance = 'compareceu' and coalesce(d.attendance_at, d.scheduled_at) <= ${at}::timestamptz
    ),
    gaps as (
      select contact_id, day, (day - lag(day) over (partition by contact_id order by day))::float8 as gap from visit_days
    ),
    visits as (
      select contact_id, count(*)::int as visits, min(day) as first_on, max(day) as last_on,
             percentile_cont(0.5) within group (order by gap) as median_gap
        from gaps group by contact_id
    ),
    misses as (
      select contact_id,
             count(*) filter (where status = 'faltou')::int as no_shows,
             count(*) filter (where status = 'cancelado')::int as cancellations
        from appointments
       where contact_id is not null and starts_at <= ${at}::timestamptz + interval '180 days'
       group by contact_id
    ),
    crm_misses as (
      select d.contact_id, count(*)::int as n from deals d
       where d.attendance = 'faltou' and not exists (select 1 from appointments a where a.deal_id = d.id)
       group by d.contact_id
    ),
    cycles as (
      select distinct on (contact_id) contact_id, cycle_days from (
        select a.contact_id, a.starts_at as at, l.cycle_days
          from appointments a join lists l on l.id = a.service_id
         where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${at}::timestamptz and l.cycle_days is not null
        union all
        select s.contact_id, s.sold_on::timestamp at time zone ${TZ}, l.cycle_days
          from sales_items s join lists l on l.kind = 'service' and lower(l.label) = lower(trim(s.item)), hoje
         where s.contact_id is not null and s.kind = 'servico' and s.sold_on <= hoje.dia and l.cycle_days is not null
      ) x order by contact_id, at desc
    ),
    pro_counts as (
      select s.contact_id,
             coalesce(s.professional_id::text, 'nome:' || upper(trim(s.professional_name))) as pro_key,
             (array_agg(s.professional_id) filter (where s.professional_id is not null))[1] as professional_id,
             max(coalesce(p.name, trim(s.professional_name))) as pro_name,
             count(*)::int as n
        from sales_items s left join professionals p on p.id = s.professional_id
       where s.contact_id is not null and s.kind = 'servico'
         and (s.professional_id is not null or nullif(trim(s.professional_name), '') is not null)
       group by 1, 2
    ),
    pro_top as (
      -- a janela soma antes do DISTINCT ON: total = todos os serviços com profissional da cliente
      select distinct on (contact_id) contact_id, professional_id, pro_name, n, (sum(n) over (partition by contact_id))::int as total
        from pro_counts order by contact_id, n desc, pro_name
    ),
    svc as (
      select contact_id, jsonb_agg(jsonb_build_object('item', item, 'n', n) order by n desc, last_on desc) as top_services
        from (
          select contact_id, item, n, last_on, row_number() over (partition by contact_id order by n desc, last_on desc) as rk
            from (select s.contact_id, trim(s.item) as item, count(*)::int as n, max(s.sold_on) as last_on
                    from sales_items s
                   where s.contact_id is not null and s.kind = 'servico' and nullif(trim(s.item), '') is not null
                   group by s.contact_id, trim(s.item)) c
        ) r
       where rk <= 3
       group by contact_id
    ),
    money as (
      select s.contact_id, coalesce(sum(s.total_cents), 0)::bigint as total_cents, count(distinct (s.sold_on, s.comanda))::int as tickets
        from ${SALES_ITEMS} s, hoje
       where s.contact_id is not null and s.sold_on <= hoje.dia
       group by s.contact_id
    ),
    pay as (
      select contact_id,
             coalesce(sum(value_cents) filter (where method ~* ${DEBT_RE}), 0)::bigint as debt_cents,
             count(*) filter (where method ~* ${DEBT_RE})::int as debt_count,
             max(coalesce(paid_on, comanda_on)) filter (where method ~* ${DEBT_RE}) as last_debt_on,
             coalesce(sum(value_cents) filter (where method ~* ${CREDIT_RE}), 0)::bigint as credit_cents,
             count(*) filter (where method ~* ${CREDIT_RE})::int as credit_count
        from sales_payments where contact_id is not null group by contact_id
    ),
    first_deal as (
      select distinct on (d.contact_id) d.contact_id, ${SOURCE_EXPR("d")} as label
        from deals d order by d.contact_id, d.created_at asc
    )
    insert into contact_stats (contact_id, visits, first_visit_on, last_visit_on, rhythm_days, cycle_days, return_due_on, no_shows, cancellations,
      tickets, total_cents, preferred_professional_id, preferred_professional_name, preferred_share, service_count, top_services,
      origin_label, avec_professional_hint, debt_cents, debt_count, last_debt_on, credit_cents, credit_count, computed_at)
    select c.id, coalesce(v.visits, 0), v.first_on, v.last_on, r.rhythm, cy.cycle_days,
           v.last_on + coalesce(r.rhythm, cy.cycle_days::int),
           coalesce(m.no_shows, 0) + coalesce(cm.n, 0), coalesce(m.cancellations, 0),
           coalesce(mo.tickets, 0), mo.total_cents,
           case when pt.ok then pt.professional_id end, case when pt.ok then pt.pro_name end,
           case when pt.total > 0 then round(pt.n::numeric / pt.total, 2)::real end, coalesce(pt.total, 0),
           coalesce(sv.top_services, '[]'::jsonb),
           coalesce(case when cc.raw !~* ${CLIENTE_RE} then upper(left(cc.raw, 1)) || lower(substr(cc.raw, 2)) end,
                    case when fd.label <> ${NOT_IDENTIFIED} then fd.label end),
           case when cc.raw ~* ${CLIENTE_RE} then initcap(lower(regexp_replace(cc.raw, ${CLIENTE_PREFIX_RE}, '', 'i'))) end,
           coalesce(pa.debt_cents, 0), coalesce(pa.debt_count, 0), pa.last_debt_on, coalesce(pa.credit_cents, 0), coalesce(pa.credit_count, 0),
           ${at}::timestamptz
      from contacts c
      cross join lateral (select nullif(trim(c.imported_fields->'avec'->>'comoConheceu'), '') as raw) cc
      left join visits v on v.contact_id = c.id
      cross join lateral (select case when v.visits >= ${MIN_VISITS_FOR_RHYTHM} then greatest(1, round(v.median_gap))::int end as rhythm) r
      left join cycles cy on cy.contact_id = c.id
      left join misses m on m.contact_id = c.id
      left join crm_misses cm on cm.contact_id = c.id
      left join (select *, total >= ${PREFERRED_MIN_SERVICES} and n::real / total >= ${PREFERRED_MIN_SHARE} as ok from pro_top) pt on pt.contact_id = c.id
      left join svc sv on sv.contact_id = c.id
      left join money mo on mo.contact_id = c.id
      left join pay pa on pa.contact_id = c.id
      left join first_deal fd on fd.contact_id = c.id`);
  const [r] = (await tx.execute(sql`select count(*)::int as contatos, count(*) filter (where visits > 0)::int as "comVisita" from contact_stats`)).rows as { contatos: number; comVisita: number }[];
  return { contatos: r.contatos, comVisita: r.comVisita, ms: Date.now() - t0 };
}

export function refreshContactStats(opts: { now?: Date } = {}): Promise<RefreshResult> {
  return db.transaction((tx) => refreshContactStatsTx(tx, opts.now ?? new Date()));
}

export type StatsSummary = {
  contatos: number; uma: number; duasAQuatro: number; cincoAOnze: number; dozeOuMais: number;
  comRitmo: number; ritmoMediano: number | null; comPreferida: number;
};

/** O resumo que o ensaio imprime para conferir com a auditoria de 15/10 (2.363 / 1.110 / 513 / 167; 1.163 com ritmo, mediana 62; 752 com preferida). */
export async function statsSummary(tx: Tx | typeof db): Promise<StatsSummary> {
  const [r] = (await tx.execute(sql`
    select count(*)::int as contatos,
      count(*) filter (where visits = 1)::int as uma,
      count(*) filter (where visits between 2 and 4)::int as "duasAQuatro",
      count(*) filter (where visits between 5 and 11)::int as "cincoAOnze",
      count(*) filter (where visits >= 12)::int as "dozeOuMais",
      count(*) filter (where rhythm_days is not null)::int as "comRitmo",
      (percentile_cont(0.5) within group (order by rhythm_days))::float8 as "ritmoMediano",
      count(*) filter (where preferred_professional_name is not null)::int as "comPreferida"
    from contact_stats`)).rows as StatsSummary[];
  return r;
}
