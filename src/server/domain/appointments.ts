import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { appointments, auditLog, lists, professionals } from "../db/schema";
import { UserFacingError } from "./errors";
import { dayOf } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { APPOINTMENT_MARKS, OCCUPYING_STATUSES, checkTransition, type AppointmentMark, type ApptVia } from "@/lib/appointment-status";
import { conflictText } from "@/lib/agenda-text";
import { agendaFunnelTx } from "./agenda/funnel-hook";
import { lockAgendaTx } from "./agenda/locks";
import { checkSlotTx } from "./agenda/slots";
import { afterAgendaChange } from "./agenda/notify";
import { canFitIn, type Actor } from "./agenda/actor";
import { assertUndoAllowedTx } from "./caixa/agenda-hooks";
import { queueProNotificationsTx } from "./pro/notifications";

export { APPOINTMENT_MARKS, type AppointmentMark } from "@/lib/appointment-status";
export type StatusOpts = { via?: ApptVia; now?: Date; confirmedVia?: "recepcao" | "link" | "enquete"; /** Lote 7A: só se o horário for desta profissional (posse na transação). */ professionalId?: string };

type Stamp = "confirmedAt" | "arrivedAt" | "startedAt" | "finishedAt";
const STAMP: Partial<Record<string, Stamp>> = { confirmado: "confirmedAt", chegou: "arrivedAt", em_atendimento: "startedAt", compareceu: "finishedAt" };
/** O que conta para o Desfazer: a última mudança de situação; remarcar ou desfazer encerram a cadeia. */
const UNDO_ACTIONS = ["agendamento_situacao", "agendamento_desfeito", "agendamento_remarcado"];

/**
 * A porta única de status (6.4, regra 1) dentro de uma transação que já existe: confere a transição (4.3), grava o carimbo,
 * marca como mexido no CRM (a importação não toca mais), audita de-para e chama o gancho do funil (1C). Repetir o mesmo valor
 * não faz nada. Cancelar tem a própria porta (`cancelAppointments`, exige motivo); voltar atrás é `undoAppointmentStatus`.
 */
export async function setAppointmentStatusTx(tx: Tx, id: string, status: AppointmentMark, userId: string | null, opts: StatusOpts & { now: Date }) {
  const value = z.enum(APPOINTMENT_MARKS).parse(status);
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
  if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
  // Lote 7A: posse dentro da transação. A profissional só mexe nos horários dela; de outra, "Horário não encontrado." (seção 8.4.1).
  if (opts.professionalId && a.professionalId !== opts.professionalId) throw new UserFacingError("Horário não encontrado.");
  const day = dayOf(a.startsAt);
  if (a.status === value) return { changed: false, day, contactId: a.contactId, dealIds: [] as string[] };
  const via = opts.via ?? "recepcao";
  const t = checkTransition(a.status, value, { startsAt: a.startsAt, now: opts.now, via });
  if (!t.ok) throw new UserFacingError(t.error);
  const now = opts.now;
  const set: Partial<typeof appointments.$inferInsert> = { status: value, updatedAt: now, updatedBy: userId, crmTouchedAt: now };
  const stamp = STAMP[value];
  if (stamp) set[stamp] = now;
  if (value === "confirmado") set.confirmedVia = opts.confirmedVia ?? (via === "link" ? "link" : "recepcao");
  // Finalizar ou iniciar sem ter marcado Chegou: os carimbos ficam com a mesma hora.
  if ((value === "compareceu" || value === "em_atendimento") && !a.arrivedAt) set.arrivedAt = now;
  await tx.update(appointments).set(set).where(eq(appointments.id, a.id));
  await tx.insert(auditLog).values({ userId, action: "agendamento_situacao", entity: "appointment", entityId: a.id, data: { de: a.status, para: value, via }, createdAt: now });
  await queueProNotificationsTx(tx, { kind: "status", from: a.status, appointment: { ...a, status: value } }, { actorId: userId, via, now });
  const dealIds = await agendaFunnelTx(tx, [a.contactId], now);
  return { changed: true, day, contactId: a.contactId, dealIds };
}

/**
 * Chegou vale para a visita inteira (17/10, pedido da Casa: "só abre um atendimento e não a comanda que abre todos os demais serviços"):
 * os outros horários agendados ou confirmados da mesma cliente no mesmo dia também ficam Chegou, na mesma transação.
 * A profissional (app dela, `professionalId`) continua marcando só o horário dela.
 */
async function arriveRestOfVisitTx(tx: Tx, id: string, userId: string | null, opts: StatusOpts & { now: Date }): Promise<{ n: number; dealIds: string[] }> {
  const [a] = await tx.select({ contactId: appointments.contactId, clientName: appointments.clientName, startsAt: appointments.startsAt }).from(appointments).where(eq(appointments.id, id));
  if (!a) return { n: 0, dealIds: [] };
  const from = new Date(slotMs(dayOf(a.startsAt), "00:00"));
  const rest = await tx.select({ id: appointments.id }).from(appointments)
    .where(and(a.contactId ? eq(appointments.contactId, a.contactId) : and(isNull(appointments.contactId), eq(appointments.clientName, a.clientName ?? "")),
      ne(appointments.id, id), isNull(appointments.avecTwinOf), inArray(appointments.status, ["agendado", "confirmado"]),
      sql`to_char(${appointments.startsAt} at time zone 'America/Bahia', 'HH24:MI') <> '00:00'`, // o "sem hora" do Avec não chega junto
      gte(appointments.startsAt, from), lt(appointments.startsAt, new Date(from.getTime() + 86_400_000))));
  let n = 0;
  const dealIds: string[] = [];
  for (const r of rest) {
    const x = await setAppointmentStatusTx(tx, r.id, "chegou", userId, opts);
    if (x.changed) { n++; dealIds.push(...x.dealIds); }
  }
  return { n, dealIds };
}

export async function setAppointmentStatus(id: string, status: AppointmentMark, userId: string | null, opts: StatusOpts = {}): Promise<{ changed: boolean; alsoArrived?: number }> {
  const now = opts.now ?? new Date();
  const r = await db.transaction(async (tx) => {
    const one = await setAppointmentStatusTx(tx, id, status, userId, { ...opts, now });
    const rest = status === "chegou" && !opts.professionalId ? await arriveRestOfVisitTx(tx, id, userId, { ...opts, now }) : { n: 0, dealIds: [] };
    return { ...one, alsoArrived: rest.n, dealIds: [...new Set([...one.dealIds, ...rest.dealIds])] };
  });
  if (r.changed || r.alsoArrived) await afterAgendaChange([r.day], r.dealIds);
  // Fase B: Finalizado pode concluir a visita → Depois do atendimento (depois do commit; engole o erro, nunca derruba o Finalizado).
  if (r.changed && status === "compareceu") await (await import("./after-visit")).afterVisitAfterCommit([id], now);
  return { changed: r.changed, ...(r.alsoArrived ? { alsoArrived: r.alsoArrived } : {}) };
}

/**
 * "Desfazer" (4.3): volta ao status anterior, no mesmo dia da mudança, lendo o de-para da auditoria. Quem chama confere `agenda.marcar`.
 * Voltar de Cancelado ou Faltou para um status que ocupa a agenda confere de novo o horário (pode já estar com outra cliente):
 * só volta por cima com `agenda.encaixar`, e fica como encaixe.
 */
export async function undoAppointmentStatus(id: string, actor: Actor, now = new Date()): Promise<{ from: string; to: string }> {
  const r = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    await assertUndoAllowedTx(tx, a.id);
    const [last] = await tx.select().from(auditLog)
      .where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, a.id), inArray(auditLog.action, UNDO_ACTIONS)))
      .orderBy(desc(auditLog.createdAt)).limit(1);
    const data = (last?.data ?? {}) as { de?: unknown; para?: unknown };
    if (!last || last.action !== "agendamento_situacao" || data.para !== a.status || typeof data.de !== "string") throw new UserFacingError("Não há o que desfazer neste horário.");
    if (dayOf(last.createdAt) !== dayOf(now)) throw new UserFacingError("Só dá para desfazer no mesmo dia da mudança.");
    const back = data.de;
    const set: Partial<typeof appointments.$inferInsert> = { status: back, updatedAt: now, updatedBy: actor.id, crmTouchedAt: now };
    const stamp = STAMP[a.status];
    if (stamp) set[stamp] = null;
    if (a.status === "confirmado") set.confirmedVia = null;
    if (a.status === "cancelado") Object.assign(set, { cancelledAt: null, cancelReason: null, cancelNote: null, cancelledBy: null, cancelledVia: null });
    if (!OCCUPYING_STATUSES.includes(a.status) && OCCUPYING_STATUSES.includes(back) && a.professionalId) {
      const [svc] = a.serviceId ? await tx.select({ durationMin: lists.durationMin, bufferMin: lists.bufferMin }).from(lists).where(eq(lists.id, a.serviceId)) : [];
      const durationMin = a.durationMin ?? svc?.durationMin ?? null;
      if (durationMin != null) {
        await lockAgendaTx(tx, { professionalIds: [a.professionalId], contactId: a.contactId, days: [dayOf(a.startsAt)] });
        // `now: a.startsAt`: confere só o conflito (o horário pode já ter passado, e desfazer uma falta é legítimo).
        const check = await checkSlotTx(tx, { professionalId: a.professionalId, startsAt: a.startsAt, durationMin, bufferMin: a.bufferMin ?? svc?.bufferMin ?? null, clientId: a.contactId, ignoreAppointmentId: a.id, now: a.startsAt });
        if (check.ok && check.fitIn) {
          if (!canFitIn(actor)) {
            const [p] = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, a.professionalId));
            throw new UserFacingError(conflictText(p?.name ?? "A profissional", check.conflicts[0]));
          }
          Object.assign(set, { fitIn: true, fitInBy: actor.id });
        }
      }
    }
    await tx.update(appointments).set(set).where(eq(appointments.id, a.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_desfeito", entity: "appointment", entityId: a.id, data: { de: a.status, para: back }, createdAt: now });
    const dealIds = await agendaFunnelTx(tx, [a.contactId], now);
    return { from: a.status, to: back, day: dayOf(a.startsAt), dealIds };
  });
  await afterAgendaChange([r.day], r.dealIds);
  return { from: r.from, to: r.to };
}

const notesSchema = z.string().trim().max(1000, "Use até 1000 caracteres na observação.");

/** A observação deste horário (vale em qualquer modo da agenda). */
export async function updateAppointmentNotes(id: string, notes: string | null, actorId: string, now = new Date()): Promise<{ changed: boolean }> {
  const value = notesSchema.parse(notes ?? "") || null;
  const r = await db.transaction(async (tx) => {
    const [a] = await tx.select({ notes: appointments.notes, startsAt: appointments.startsAt, avecTwinOf: appointments.avecTwinOf })
      .from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    if ((a.notes ?? null) === value) return { changed: false, day: dayOf(a.startsAt) };
    await tx.update(appointments).set({ notes: value, updatedAt: now, updatedBy: actorId, crmTouchedAt: now }).where(eq(appointments.id, id));
    await tx.insert(auditLog).values({ userId: actorId, action: "agendamento_observacao", entity: "appointment", entityId: id, data: { de: a.notes, para: value }, createdAt: now });
    return { changed: true, day: dayOf(a.startsAt) };
  });
  if (r.changed) await afterAgendaChange([r.day]);
  return { changed: r.changed };
}
