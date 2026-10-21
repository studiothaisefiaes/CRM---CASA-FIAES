import { cookies } from "next/headers";
import { and, desc, eq, isNull, lt, inArray } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals } from "../db/schema";
import { cancelRemarcarTx } from "./tasks";
import { cancelAppointments } from "./agenda/visits";
import type { Actor } from "./agenda/actor";

/**
 * Quando a atendente clica em "Faltou" o diálogo pergunta o que houve (20/10): ela só não veio, ou cancelou? E a conversa fica com "Remarcar"?
 * A escolha viaja num cookie curto (o diálogo é um só para as 7 telas que marcam falta) e o servidor a lê na hora de marcar e a apaga.
 * Sem cookie, nada muda: só não veio, e a conversa ganha "Remarcar" como sempre.
 */
export type FaltaEscolha = { t: "faltou" | "cancelou"; r: boolean };
export const FALTA_COOKIE = "casa_falta";

export async function lerEscolhaFalta(): Promise<FaltaEscolha | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(FALTA_COOKIE)?.value;
    if (!raw) return null;
    jar.delete(FALTA_COOKIE);
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<FaltaEscolha>;
    return { t: v.t === "cancelou" ? "cancelou" : "faltou", r: v.r !== false };
  } catch { return null; }
}

/** Cancelou em vez de faltar: o horário vira Cancelado (a cliente desmarcou), não Faltou. */
export async function cancelarNoLugarDaFalta(id: string, actor: Actor): Promise<void> {
  await cancelAppointments({ appointmentId: id, scope: "este", reason: "cliente_desmarcou", note: null, via: "recepcao" }, actor);
}

/** Não é para remarcar agora: a tarefa "Remarcar" que a falta criou sai. */
export async function semRemarcar(dealId: string, userId: string): Promise<void> {
  await db.transaction((tx) => cancelRemarcarTx(tx, dealId, userId));
}

/** O mesmo, partindo do horário: as conversas abertas da cliente dele. */
export async function semRemarcarDoHorario(appointmentId: string, userId: string): Promise<void> {
  const [a] = await db.select({ contactId: appointments.contactId }).from(appointments).where(eq(appointments.id, appointmentId));
  if (!a?.contactId) return;
  const open = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, a.contactId), isNull(deals.closedAt), isNull(deals.archivedAt)));
  for (const d of open) await semRemarcar(d.id, userId);
}

/** Pela conversa (Hoje, Fila): cancela o último horário já passado da cliente que ainda não tinha desfecho. Se não houver, não faz nada. */
export async function cancelarUltimoPassado(dealId: string, actor: Actor, now = new Date()): Promise<void> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return;
  const [a] = await db.select({ id: appointments.id }).from(appointments)
    .where(and(eq(appointments.contactId, d.contactId), lt(appointments.startsAt, now), inArray(appointments.status, ["agendado", "confirmado", "chegou", "conferir"])))
    .orderBy(desc(appointments.startsAt)).limit(1);
  if (a) await cancelAppointments({ appointmentId: a.id, scope: "este", reason: "cliente_desmarcou", note: null, via: "recepcao" }, actor).catch(() => undefined);
}
