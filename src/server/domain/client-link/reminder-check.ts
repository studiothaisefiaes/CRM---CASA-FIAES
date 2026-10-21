import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments } from "../../db/schema";
import { isEveOf } from "@/lib/reminder-d1";
import { getLembreteD1 } from "./settings";

/** `lembrete_d1:<visita>:<início ISO>`: o lembrete 24 h antes, um por visita e início. */
export const REMINDER_SOURCE = "lembrete_d1:";
/** `lembrete_d1_remarcado:<horário>:<início novo ISO>`: o aviso de que o horário foi remarcado. */
export const RESCHEDULED_SOURCE = "lembrete_d1_remarcado:";
/** Confirmou há menos disso: o lembrete não sai (pedido do dono). */
export const RECENT_CONFIRM_MS = 24 * 3_600_000;
const ACTIVE = ["agendado", "confirmado"];
/** A visita já começou (ou acabou): chegou, atendendo, finalizado ou faltou num dos serviços. Não tem mais lembrete. */
export const VISIT_STARTED = ["chegou", "em_atendimento", "compareceu", "faltou"];
export const ALREADY_CAME = "A cliente já está na Casa ou já foi atendida.";

/** "<id>:<ISO>" → as duas partes (o ISO tem ":" dentro). */
const split = (rest: string) => { const i = rest.indexOf(":"); return { id: rest.slice(0, i), start: rest.slice(i + 1) }; };

/**
 * Reconferência na hora de enviar (não importa a fila, para não ter ciclo). Devolve o motivo de cancelar, ou null se pode sair:
 * lembrete ligado; horário ainda ativo (cancelado e faltou nunca recebem); mesmo início de quando entrou na fila; no futuro;
 * e, no lembrete, hoje (Salvador) ainda é a véspera do horário (o texto diz "amanhã"; 17/10) e a cliente não confirmou nas últimas 24 h.
 */
export async function reminderStillValid(source: string, now: Date): Promise<string | null> {
  if (!(await getLembreteD1()).enabled) return "O lembrete foi desligado.";
  if (source.startsWith(RESCHEDULED_SOURCE)) {
    const { id, start } = split(source.slice(RESCHEDULED_SOURCE.length));
    const [a] = await db.select({ startsAt: appointments.startsAt, status: appointments.status }).from(appointments).where(eq(appointments.id, id));
    if (!a || !ACTIVE.includes(a.status)) return "O horário foi cancelado.";
    if (a.startsAt.toISOString() !== start) return "O horário mudou.";
    if (a.startsAt.getTime() <= now.getTime()) return "O horário já passou.";
    return null;
  }
  const { id: visitId, start } = split(source.slice(REMINDER_SOURCE.length));
  const all = await db.select({ startsAt: appointments.startsAt, status: appointments.status, confirmedAt: appointments.confirmedAt }).from(appointments)
    .where(and(eq(appointments.visitId, visitId), isNull(appointments.avecTwinOf))).orderBy(asc(appointments.startsAt));
  if (all.some((a) => VISIT_STARTED.includes(a.status))) return ALREADY_CAME;
  const appts = all.filter((a) => ACTIVE.includes(a.status));
  if (!appts.length) return "O horário foi cancelado.";
  if (appts[0].startsAt.toISOString() !== start) return "O horário mudou.";
  if (appts[0].startsAt.getTime() <= now.getTime()) return "O horário já passou.";
  if (!isEveOf(now.getTime(), appts[0].startsAt.getTime())) return "Já não é a véspera do horário.";
  if (appts.every((a) => a.status === "confirmado") && appts.some((a) => a.confirmedAt && now.getTime() - a.confirmedAt.getTime() < RECENT_CONFIRM_MS)) return "A cliente confirmou há pouco.";
  return null;
}
