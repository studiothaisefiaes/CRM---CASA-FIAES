import { sql } from "drizzle-orm";
import { rows } from "./common";
import { todayBahia } from "../../lib/salon-period";

export const COHORT_WINDOWS = [30, 60, 90] as const;
export const COHORT_MONTHS = 12;
export type CohortCell = { base: number; voltou: number };
export type CohortRow = { month: string; novas: number; d30: CohortCell; d60: CohortCell; d90: CohortCell };
export type Cohorts = { dataEnd: string | null; rows: CohortRow[] };

/**
 * Retorno por coorte: clientes cuja PRIMEIRA visita (comanda ou horário com Compareceu, Avec ou CRM) caiu em cada um dos últimos 12 meses,
 * e quantas voltaram (visita em outro dia) em até 30, 60 e 90 dias. Só entra na base quem já teve o tempo inteiro para voltar até a
 * última visita registrada (`dataEnd`): sem isso, o mês recente pareceria pior do que é (os dados do Avec são uma foto).
 */
export async function returnCohorts(now = new Date()): Promise<Cohorts> {
  const today = todayBahia(now), nowIso = now.toISOString();
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(y, m0 - (COHORT_MONTHS - 1), 1)).toISOString().slice(0, 10);
  const visits = sql`
    select si.contact_id, si.sold_on as day from sales_items si where si.contact_id is not null and si.sold_on <= ${today}::date
    union
    select a.contact_id, (a.starts_at at time zone 'America/Bahia')::date from appointments a
    where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${nowIso}::timestamptz`;
  const [end] = await rows<{ d: string | null }>(sql`with visits as (${visits}) select max(day)::text as d from visits`);
  if (!end?.d) return { dataEnd: null, rows: [] };
  const windows = sql.join(COHORT_WINDOWS.map((w) => sql`
    count(*) filter (where f.first_day + ${w}::int <= ${end.d}::date)::int as ${sql.raw(`base${w}`)},
    count(*) filter (where f.first_day + ${w}::int <= ${end.d}::date and exists (select 1 from visits v
      where v.contact_id = f.contact_id and v.day > f.first_day and v.day <= f.first_day + ${w}::int))::int as ${sql.raw(`voltou${w}`)}`), sql`,`);
  const r = await rows<Record<string, unknown>>(sql`
    with visits as (${visits}), firsts as (select contact_id, min(day) as first_day from visits group by contact_id)
    select to_char(f.first_day, 'YYYY-MM') as month, count(*)::int as novas, ${windows}
    from firsts f where f.first_day >= ${start}::date group by 1 order by 1 desc`);
  const cell = (x: Record<string, unknown>, w: number): CohortCell => ({ base: Number(x[`base${w}`] ?? 0), voltou: Number(x[`voltou${w}`] ?? 0) });
  return { dataEnd: end.d, rows: r.map((x) => ({ month: String(x.month), novas: Number(x.novas), d30: cell(x, 30), d60: cell(x, 60), d90: cell(x, 90) })) };
}
