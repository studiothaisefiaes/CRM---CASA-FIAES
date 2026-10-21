import { sql } from "drizzle-orm";
import { db } from "../../db";

/**
 * Horários parados de dias anteriores (QA r66, I-6): "Chegou" que ninguém finalizou e "agendado/confirmado" que já passaram, sem venda no dia
 * e sem conversa recente. Ficam como "sem desfecho" (status `conferir`, o da lista Conferir/Sem desfecho), com o status de antes no
 * `audit_log` (`horario_sem_desfecho`, `data.de`). Nunca marca Faltou nem Compareceu por conta própria: quem decide é a recepção.
 * Com venda do Avec ou comanda da cliente no dia, o horário já foi tratado (baixa pela venda) e fica como está. Idempotente: o que já está
 * em `conferir` não entra de novo. `crm_touched_at` marca a decisão da Casa para a importação do Avec não devolver o status antigo.
 */
/** `chegou`/`agendados`: marcados (ou que seriam, no dry-run). `comVenda`/`comConversa`: ficam como estão. */
export type SemDesfechoReport = { chegou: number; agendados: number; comVenda: number; comConversa: number };
export const CONVERSA_RECENTE_DIAS = 14;

class DryRun extends Error {}

export async function marcarSemDesfecho(opts: { apply: boolean; now: Date }): Promise<SemDesfechoReport> {
  const iso = opts.now.toISOString();
  let out!: SemDesfechoReport;
  try {
    await db.transaction(async (tx) => {
      const today = sql`((${iso}::timestamptz) at time zone 'America/Bahia')::date`;
      const day = sql`((a.starts_at) at time zone 'America/Bahia')::date`;
      const cand = sql`
        from appointments a
        where a.avec_twin_of is null and a.status in ('chegou', 'agendado', 'confirmado') and ${day} < ${today}`;
      const venda = sql`(
        exists (select 1 from sales_items s where s.sold_on = ${day} and ((a.contact_id is not null and s.contact_id = a.contact_id)
          or (a.contact_id is null and lower(trim(s.client_name)) = lower(trim(a.client_name)) and nullif(trim(a.client_name), '') is not null)))
        or exists (select 1 from sales_payments p where coalesce(p.paid_on, p.comanda_on) = ${day} and a.contact_id is not null and p.contact_id = a.contact_id)
        or exists (select 1 from comanda_items ci where ci.appointment_id = a.id and ci.cancelled_at is null)
        or exists (select 1 from comandas c where c.day = ${day} and a.contact_id is not null and c.contact_id = a.contact_id and c.status <> 'cancelada'))`;
      const conversa = sql`(a.contact_id is not null and exists (select 1 from messages m where m.contact_id = a.contact_id
        and m.created_at >= (${iso}::timestamptz - make_interval(days => ${CONVERSA_RECENTE_DIAS}))))`;
      const [c] = (await tx.execute(sql`select
        count(*) filter (where a.status = 'chegou' and not ${venda})::int as chegou,
        count(*) filter (where a.status in ('agendado', 'confirmado') and not ${venda} and not ${conversa})::int as agendados,
        count(*) filter (where ${venda})::int as "comVenda",
        count(*) filter (where a.status in ('agendado', 'confirmado') and not ${venda} and ${conversa})::int as "comConversa"
        ${cand}`)).rows as SemDesfechoReport[];
      out = { chegou: c.chegou, agendados: c.agendados, comVenda: c.comVenda, comConversa: c.comConversa };
      const alvo = sql`${cand} and not ${venda} and (a.status = 'chegou' or not ${conversa})`;
      await tx.execute(sql`with alvo as (select a.id, a.status as de ${alvo}), up as (
          update appointments a set status = 'conferir', avec_status = coalesce(a.avec_status, alvo.de), crm_touched_at = coalesce(a.crm_touched_at, ${iso}::timestamptz),
            updated_at = ${iso}::timestamptz
          from alvo where a.id = alvo.id returning a.id, alvo.de)
        insert into audit_log (action, entity, entity_id, data)
        select 'horario_sem_desfecho', 'appointment', up.id::text, jsonb_build_object('de', up.de, 'para', 'conferir') from up`);
      if (!opts.apply) throw new DryRun();
    });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return out;
}
