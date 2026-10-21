import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments } from "../../db/schema";
import { UserFacingError } from "../errors";
import { NO_SHOW_AFTER_MIN, PRO_ACTION_STATUS, type ProAction } from "@/lib/pro-day";
import { changeStatus } from "../agenda/ports";
import { undoAppointmentStatus } from "../appointments";
import { feedComandaFromPro, type ComandaFeed } from "./comanda-bridge";
import type { ProContext } from "../../queries/pro";
import { cancelarNoLugarDaFalta, semRemarcarDoHorario, type FaltaEscolha } from "../falta-escolha";

const NOT_FOUND = "Horário não encontrado.";
const hersOnly = (pro: ProContext, id: string) => and(eq(appointments.id, id), eq(appointments.professionalId, pro.professionalId), isNull(appointments.avecTwinOf));

/**
 * Chegou, Iniciar, Finalizar e Faltou no app (seção 8.4.3). Tudo pela porta única do 6B, com `via = 'profissional'` e a posse conferida
 * lá dentro. Faltou só 15 min depois do início. Finalizar, com o caixa no CRM, alimenta a comanda da visita.
 */
export async function proAct(pro: ProContext, appointmentId: string, action: ProAction, now = new Date(), falta: FaltaEscolha | null = null): Promise<{ changed: boolean; comanda: ComandaFeed }> {
  const [a] = await db.select({ startsAt: appointments.startsAt }).from(appointments).where(hersOnly(pro, appointmentId));
  if (!a) throw new UserFacingError(NOT_FOUND);
  if (action === "faltou" && now.getTime() < a.startsAt.getTime() + NO_SHOW_AFTER_MIN * 60_000) {
    throw new UserFacingError(`Só dá para marcar falta ${NO_SHOW_AFTER_MIN} minutos depois do horário.`);
  }
  // "Faltou" pergunta o que houve (20/10): cancelou (vira Cancelado) e/ou não é para remarcar agora.
  if (action === "faltou" && falta?.t === "cancelou") {
    await cancelarNoLugarDaFalta(appointmentId, { id: pro.userId, perms: [] });
    if (!falta.r) await semRemarcarDoHorario(appointmentId, pro.userId);
    return { changed: true, comanda: "desligada" };
  }
  const r = await changeStatus({ appointmentId, status: PRO_ACTION_STATUS[action], actorId: pro.userId, via: "profissional", onlyProfessionalId: pro.professionalId, now });
  if (action === "faltou" && falta && !falta.r) await semRemarcarDoHorario(appointmentId, pro.userId);
  if (action !== "finalizar") return { changed: r.changed, comanda: "desligada" };
  return { changed: r.changed, comanda: await feedComandaFromPro({ appointmentId, professionalId: pro.professionalId, actorId: pro.userId, extraServiceIds: [] }) };
}

/** Desfazer o Faltou dela (QA r58, M-2): pela mesma porta do Desfazer da Agenda (volta ao status de antes, no mesmo dia). */
export async function proUndoNoShow(pro: ProContext, appointmentId: string, now = new Date()): Promise<void> {
  const [a] = await db.select({ status: appointments.status }).from(appointments).where(hersOnly(pro, appointmentId));
  if (!a) throw new UserFacingError(NOT_FOUND);
  if (a.status !== "faltou") throw new UserFacingError("Esse horário não está como falta.");
  await undoAppointmentStatus(appointmentId, { id: pro.userId, perms: [] }, now);
}

/** "Fez algo a mais?": só depois de finalizar e só serviços que ela faz. */
export async function proAddExtras(pro: ProContext, appointmentId: string, serviceIds: string[]): Promise<ComandaFeed> {
  const [a] = await db.select({ status: appointments.status }).from(appointments).where(hersOnly(pro, appointmentId));
  if (!a) throw new UserFacingError(NOT_FOUND);
  if (a.status !== "compareceu") throw new UserFacingError("Finalize o atendimento antes de acrescentar serviços.");
  if (!serviceIds.length) return "alimentada";
  return feedComandaFromPro({ appointmentId, professionalId: pro.professionalId, actorId: pro.userId, extraServiceIds: serviceIds });
}
