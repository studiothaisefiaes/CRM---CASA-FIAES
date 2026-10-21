import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { comandaItems, comandas } from "../../db/schema";
import { dayVisitsOf } from "../../queries/day-visit";
import type { Actor } from "../agenda/actor";
import { openComandaForAppointment } from "./comandas";

/** Estados do horário de quem já está na Casa: chegou, em atendimento ou finalizado. */
export const ARRIVED_STATUSES = ["chegou", "em_atendimento", "compareceu"] as const;

/** Horários que já estão lançados numa comanda aberta ou paga (mesmo juntados por fora da visita). */
export async function appointmentsInLiveComanda(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const used = await db.select({ id: comandaItems.appointmentId }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(inArray(comandaItems.appointmentId, ids), isNull(comandaItems.cancelledAt), inArray(comandas.status, ["aberta", "fechada"])));
  return new Set(used.map((u) => u.id).filter((x): x is string => !!x));
}

/**
 * Quem está na Casa para pagar: as visitas de hoje com alguém que chegou (Chegou, em atendimento ou finalizado) e SEM nenhuma comanda
 * (nem cancelada: quem a recepção cancelou no Caixa não volta sozinha) ganham a comanda dos serviços da visita. Idempotente.
 * "Nova comanda" fica só para a venda avulsa.
 */
export async function ensureArrivedComandas(day: string, actor: Actor, now = new Date()): Promise<number> {
  const visits = (await dayVisitsOf(day, { withValues: false })).filter((v) => !v.comanda && v.services.some((s) => (ARRIVED_STATUSES as readonly string[]).includes(s.status)));
  if (!visits.length) return 0;
  const ids = visits.map((v) => v.visitId).filter((x): x is string => !!x);
  const had = ids.length ? new Set((await db.select({ v: comandas.visitId }).from(comandas).where(and(inArray(comandas.visitId, ids), inArray(comandas.status, ["aberta", "fechada", "cancelada"])))).map((r) => r.v)) : new Set<string | null>();
  const taken = await appointmentsInLiveComanda(visits.flatMap((v) => v.services.map((x) => x.appointmentId)));
  let n = 0;
  for (const v of visits) {
    if (v.visitId && had.has(v.visitId)) continue;
    if (v.services.some((x) => taken.has(x.appointmentId))) continue;
    const first = v.services.find((s) => (ARRIVED_STATUSES as readonly string[]).includes(s.status)) ?? v.services[0];
    try { await openComandaForAppointment(first.appointmentId, actor, now); n++; } catch { /* a visita segue na lista; a recepção abre à mão */ }
  }
  return n;
}
