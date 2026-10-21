import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { commissionPayouts } from "../db/schema";
import { firstName } from "@/lib/authorship";
import { dayOf, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { buildEarnings, type Earnings, type EarningsReceipt } from "@/lib/pro-earnings";
import { commissionLinesPort } from "../domain/agenda/ports";
import { getPayoutReceipt, type PayoutReceipt } from "../domain/caixa/payouts";
import type { ProContext } from "./pro";

export type { Earnings, EarningLine, EarningsPeriod, EarningsReceipt } from "@/lib/pro-earnings";

/**
 * Os ganhos dela no mês e hoje (seção 8.4.7), lidos pelo relatório de comissão do 6C (`commissionLinesPort`): linhas de comanda
 * fechadas e não canceladas com o nome dela. Horário finalizado no CRM e ainda sem comanda fechada aparece como "aguardando fechamento".
 * "Recibos": os pagamentos da comissão dela (os últimos 12, sem os desfeitos).
 */
export async function getProEarnings(pro: ProContext, now: Date, opts: { showServiceValue: boolean }): Promise<Earnings> {
  const today = todayBahia(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const from = new Date(slotMs(monthStart, "00:00")).toISOString();
  const [lines, conf, waiting, receipts] = await Promise.all([
    commissionLinesPort({ from: monthStart, to: today, professionalId: pro.professionalId }),
    db.execute(sql`select exists (select 1 from professional_services where professional_id = ${pro.professionalId} and commission_bp is not null) as ok`),
    db.execute(sql`select a.id, a.starts_at as at, a.client_name as client, a.service_label as service from appointments a
      where a.professional_id = ${pro.professionalId} and a.status = 'compareceu' and a.finished_at is not null and a.avec_twin_of is null
        and (a.origin <> 'avec' or a.crm_touched_at is not null) -- finalizado no CRM; a baixa do Avec também carimba finished_at (Fase B)
        and a.starts_at >= ${from}::timestamptz
        and not exists (select 1 from comanda_items ci join comandas c on c.id = ci.comanda_id
                        where ci.appointment_id = a.id and ci.cancelled_at is null and c.status = 'fechada')
      order by a.starts_at desc`),
    getProReceipts(pro),
  ]);
  return buildEarnings({
    lines, today, showServiceValue: opts.showServiceValue, receipts,
    configured: !!(conf.rows[0] as { ok: boolean } | undefined)?.ok,
    waiting: (waiting.rows as { id: string; at: Date | string; client: string | null; service: string }[]).map((w) => ({ id: w.id, day: dayOf(new Date(w.at)), client: firstName(w.client) ?? "Cliente", service: w.service })),
  });
}

/** Os recibos dela (os últimos 12, sem os desfeitos). Não dependem do modo do caixa: a página mostra mesmo com o caixa no Avec. */
export async function getProReceipts(pro: ProContext): Promise<EarningsReceipt[]> {
  const rows = await db.select({ id: commissionPayouts.id, number: commissionPayouts.number, paidAt: commissionPayouts.paidAt, netCents: commissionPayouts.netCents }).from(commissionPayouts)
    .where(and(eq(commissionPayouts.professionalId, pro.professionalId), isNull(commissionPayouts.cancelledAt))).orderBy(desc(commissionPayouts.paidAt), desc(commissionPayouts.number)).limit(12);
  return rows.map((r) => ({ ...r, paidAt: r.paidAt.toISOString() }));
}

/** O recibo dela (`/pro/ganhos/recibo/[id]`); recibo de outra profissional ou que não existe = null (a página dá notFound). */
export async function getProReceipt(pro: ProContext, id: string): Promise<PayoutReceipt | null> {
  const r = await getPayoutReceipt(id);
  return r && r.professionalId === pro.professionalId ? r : null;
}
