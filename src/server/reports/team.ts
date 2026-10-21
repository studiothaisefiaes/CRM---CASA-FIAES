import { sql } from "drizzle-orm";
import { MIN_SAMPLE, WON_SQL, cohort, dealScope, iso, pct, periodWindow, rows, upTo, type ReportFilter } from "./common";
import { firstResponses } from "./queries";

export type TeamRow = {
  userId: string; name: string;
  /** Leads novos do período que estão com a pessoa. */ received: number;
  /** Primeiras respostas dadas por ela (ou pelo celular, no lead dela) e quantas no prazo. */ answered: number; onTime: number; onTimePct: number | null;
  /** Tempo típico (mediana, só expediente) da primeira resposta, em segundos. */ p50: number | null;
  /** Dos leads novos dela, quantos chegaram a Agendado ou além. */ scheduled: number;
  /** Vendas fechadas no período no nome dela; valor só com `money`. */ sales: number; salesCents: number | null;
  /** Vendas / leads novos dela (só com MIN_SAMPLE leads ou mais; antes disso, null). */ conversionPct: number | null;
  /** Menos de MIN_SAMPLE respostas: os % ficam marcados como base pequena. */ smallSample: boolean;
};

/**
 * Desempenho por atendente (PDF "por atendente"): números lado a lado em ordem alfabética, sem ranking nem nota.
 * Com `f.ownerId`, só aquela pessoa (quem não vê a equipe vê só a própria linha).
 */
export async function teamPerformance(f: ReportFilter, opts: { money: boolean }): Promise<TeamRow[]> {
  const w = periodWindow(f);
  const scope = f.ownerId ? sql`and u.id = ${f.ownerId}` : sql``;
  const data = await rows<{ userId: string; name: string; received: number; answered: number; onTime: number; p50: number | null; scheduled: number; sales: number; cents: number }>(sql`
    with fr as (${firstResponses({ ...f, ownerId: null }, w)}),
    novos as (select d.owner_id, d.id, d.stage_id from deals d where d.owner_id is not null and ${cohort({ ...f, ownerId: null }, w)}),
    vendas as (
      select d.owner_id, count(*)::int as n, coalesce(sum(d.value_cents), 0)::float8 as cents
      from deals d join stages s on s.id = d.stage_id
      where ${sql.raw(WON_SQL)} and d.closed_at >= ${iso(w.from)}::timestamptz and ${upTo("d.closed_at", w)} and ${dealScope({ ...f, ownerId: null })}
      group by d.owner_id)
    select u.id as "userId", u.name,
      (select count(*)::int from novos n where n.owner_id = u.id) as received,
      (select count(*)::int from fr where fr.user_id = u.id) as answered,
      (select count(*)::int from fr where fr.user_id = u.id and fr.w <= fr.sla) as "onTime",
      (select round(percentile_cont(0.5) within group (order by fr.w))::int from fr where fr.user_id = u.id) as p50,
      (select count(*)::int from novos n join stages s on s.id = n.stage_id where n.owner_id = u.id and s.kind in ('agendado', 'atendido', 'fechado')) as scheduled,
      coalesce(v.n, 0) as sales, coalesce(v.cents, 0) as cents
    from users u left join vendas v on v.owner_id = u.id
    where u.active ${scope}
      and (exists (select 1 from novos n where n.owner_id = u.id) or exists (select 1 from fr where fr.user_id = u.id) or v.n is not null)
    order by u.name`);
  return data.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((r) => ({
    userId: r.userId, name: r.name, received: r.received, answered: r.answered, onTime: r.onTime, onTimePct: pct(r.onTime, r.answered), p50: r.p50,
    scheduled: r.scheduled, sales: r.sales, salesCents: opts.money ? Math.round(Number(r.cents)) : null,
    conversionPct: r.received >= MIN_SAMPLE ? pct(r.sales, r.received) : null, smallSample: r.answered < MIN_SAMPLE,
  }));
}
