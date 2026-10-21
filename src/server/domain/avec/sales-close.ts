import { sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { normText } from "./normalize";

/**
 * Comanda ou pagamento do Avec dá baixa (17/10): "já pagaram" no Avec e o CRM continuava em agendado (26 sem baixa em 7 dias; caso Karina,
 * horário do CRM com o gêmeo do Avec em compareceu). O horário fechado vira compareceu e guarda o status de antes em `avec_status`.
 * Mexido no CRM (`crm_touched_at`): o status fica e o horário só ganha `avec_status = 'compareceu'` (aparece em "Conferir com o Avec").
 * Não avisa a profissional e não marca `crm_touched_at`: é o Avec falando, como o "Pago" da reserva. Gêmeo do Avec e cancelado/faltou não mudam.
 *
 * 18/10 (QA r58, I-14): antes uma venda fechava TODOS os horários abertos da cliente no dia (518 de uma vez na limpeza). Agora só fecha o que
 * bate com a venda (`saleDecision`); o que não bate fica como está e ganha `avec_review = 'venda_sem_par'` ("Conferir com o Avec").
 */
export const CLOSABLE = ["agendado", "confirmado", "chegou", "em_atendimento", "conferir"];
const BATCH = 500;

/** Uma venda do Avec da cliente no dia. `soldAt`: a hora do pagamento, quando o relatório traz (os de hoje só trazem a data). */
export type SaleDay = { contactId: string; day: string; soldAt?: Date | null };
/** O que o item de comanda diz: quem fez e o quê. Item sem profissional e que não é serviço (produto, taxa) não é detalhe. */
export type SaleDetail = { professionalId: string | null; item: string; kind: string; serviceId: string | null };
export type SaleAppt = { professionalId: string | null; serviceId: string | null; serviceLabel: string; startsAt: Date };

/** Os itens que dizem algo sobre o atendimento: com profissional, ou que são serviço. */
export const isDetail = (d: SaleDetail) => !!d.professionalId || d.kind === "servico" || !!d.serviceId;

/**
 * Fecha ou não fecha (função pura, usada pela importação e pelo script de correção):
 *  - com detalhe (itens de comanda): fecha se algum item é do mesmo serviço, ou se é serviço da mesma profissional e a venda tem a hora
 *    e o horário já tinha começado antes dela (QA r66, I-3: a profissional sozinha não basta; ela pode ter outro serviço no dia);
 *  - sem detalhe e com a hora da venda: fecha se o horário já tinha começado antes da venda;
 *  - sem detalhe e sem hora: na dúvida, não fecha (vai para conferir).
 */
export function saleDecision(a: SaleAppt, sale: { details: SaleDetail[]; soldAt: Date | null }): "fecha" | "conferir" {
  const details = sale.details.filter(isDetail);
  const began = !!sale.soldAt && a.startsAt.getTime() <= sale.soldAt.getTime();
  if (details.length) {
    const label = normText(a.serviceLabel);
    const sameService = details.some((d) => (!!a.serviceId && d.serviceId === a.serviceId) || (!!label && normText(d.item) === label));
    // Produto vendido pela profissional não diz qual serviço dela foi pago: só serviço entra na regra profissional + hora.
    const sameProAndTime = began && details.some((d) => d.kind === "servico" && !!d.professionalId && d.professionalId === a.professionalId);
    return sameService || sameProAndTime ? "fecha" : "conferir";
  }
  return began ? "fecha" : "conferir";
}

type Cand = { id: string; contact_id: string; day: string; professional_id: string | null; service_id: string | null; service_label: string; starts_at: string | Date; crm_touched_at: string | null; avec_review: string | null };

export async function closeFromAvecSales(tx: Tx, pairs: SaleDay[], now: Date): Promise<{ closed: number; flagged: number; review: number }> {
  const byKey = new Map<string, SaleDay>();
  for (const p of pairs) {
    const k = `${p.contactId}|${p.day}`, old = byKey.get(k);
    const soldAt = [old?.soldAt, p.soldAt].filter((x): x is Date => !!x).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    byKey.set(k, { contactId: p.contactId, day: p.day, soldAt });
  }
  const uniq = [...byKey.values()];
  const services = new Map(((await tx.execute(sql`select id, label from lists where kind = 'service'`)).rows as { id: string; label: string }[]).map((s) => [normText(s.label), s.id]));
  let closed = 0, flagged = 0, review = 0;
  const statuses = sql.join(CLOSABLE.map((s) => sql`${s}`), sql`, `);
  const iso = now.toISOString();
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH);
    const ids = `{${chunk.map((p) => p.contactId).join(",")}}`, days = `{${chunk.map((p) => p.day).join(",")}}`;
    const cands = (await tx.execute(sql`select a.id, a.contact_id, v.day::text as day, a.professional_id, a.service_id, a.service_label, a.starts_at, a.crm_touched_at, a.avec_review
      from appointments a join unnest(${ids}::uuid[], ${days}::date[]) as v(contact_id, day)
        on a.contact_id = v.contact_id and (a.starts_at at time zone 'America/Bahia')::date = v.day
      where a.status in (${statuses}) and a.avec_twin_of is null and a.starts_at <= ${iso}::timestamptz`)).rows as Cand[];
    if (!cands.length) continue;
    const items = (await tx.execute(sql`select s.contact_id, s.sold_on::text as day, s.professional_id, s.item, s.kind
      from sales_items s join unnest(${ids}::uuid[], ${days}::date[]) as v(contact_id, day) on s.contact_id = v.contact_id and s.sold_on = v.day`)).rows as
      { contact_id: string; day: string; professional_id: string | null; item: string; kind: string }[];
    const detailsOf = new Map<string, SaleDetail[]>();
    for (const it of items) {
      const k = `${it.contact_id}|${it.day}`;
      detailsOf.set(k, [...(detailsOf.get(k) ?? []), { professionalId: it.professional_id, item: it.item, kind: it.kind, serviceId: services.get(normText(it.item)) ?? null }]);
    }
    const fecha: string[] = [], fechaMexido: string[] = [], conferir: string[] = [];
    const soldAtOf = new Map<string, string | null>();
    for (const c of cands) {
      const k = `${c.contact_id}|${c.day}`;
      const d = saleDecision({ professionalId: c.professional_id, serviceId: c.service_id, serviceLabel: c.service_label, startsAt: new Date(c.starts_at) },
        { details: detailsOf.get(k) ?? [], soldAt: byKey.get(k)?.soldAt ?? null });
      if (d === "conferir") { if (c.avec_review !== "venda_sem_par") conferir.push(c.id); }
      else if (c.crm_touched_at) fechaMexido.push(c.id);
      else { fecha.push(c.id); soldAtOf.set(c.id, byKey.get(k)?.soldAt?.toISOString() ?? null); }
    }
    const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);
    if (fecha.length) {
      const done = await tx.execute(sql`update appointments a set status = 'compareceu', avec_status = coalesce(a.avec_status, a.status), avec_review = null, updated_at = ${iso}::timestamptz,
        finished_at = coalesce(a.finished_at, ${iso}::timestamptz)
        where a.id in (${list(fecha)}) returning a.id, a.avec_status as de`);
      for (const r of done.rows as { id: string; de: string }[]) {
        await tx.execute(sql`insert into audit_log (action, entity, entity_id, data) values ('avec_baixa_comanda', 'appointment', ${r.id}, ${JSON.stringify({ de: r.de, para: "compareceu", regra: 2, soldAt: soldAtOf.get(r.id) ?? null })}::jsonb)`);
      }
      closed += done.rows.length;
    }
    if (fechaMexido.length) {
      const marked = await tx.execute(sql`update appointments a set avec_status = 'compareceu', updated_at = ${iso}::timestamptz
        where a.id in (${list(fechaMexido)}) and a.avec_status is distinct from 'compareceu' returning a.id`);
      flagged += marked.rows.length;
    }
    if (conferir.length) {
      const marked = await tx.execute(sql`update appointments a set avec_review = 'venda_sem_par', updated_at = ${iso}::timestamptz
        where a.id in (${list(conferir)}) returning a.id`);
      for (const r of marked.rows as { id: string }[]) {
        await tx.execute(sql`insert into audit_log (action, entity, entity_id, data) values ('avec_venda_conferir', 'appointment', ${r.id}, ${JSON.stringify({ de: null, para: "venda_sem_par" })}::jsonb)`);
      }
      review += marked.rows.length;
    }
  }
  return { closed, flagged, review };
}
