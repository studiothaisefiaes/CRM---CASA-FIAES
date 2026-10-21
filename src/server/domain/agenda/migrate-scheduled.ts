import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, contacts, deals, lists, stages, visits } from "../../db/schema";
import { dayOf } from "@/lib/agenda";
import { lockAgendaTx } from "./locks";
import { checkSlotTx } from "./slots";
import { visitForDayTx } from "./visits";
import { afterAgendaChange } from "./notify";

/**
 * Antes do 6B, o horário marcado pela conversa vivia só no lead (`deals.scheduled_at`). Esta migração cria o horário do CRM para cada
 * lead em Agendado com horário futuro (a Agenda e o funil passam a falar do horário). Nunca recusa: o horário já foi combinado com a
 * cliente; conflito, bloqueio ou fora do horário entram como encaixe, para a recepção ver. O que já passou continua no lead
 * (Compareceu/Faltou de antes). Idempotente: o que já tem horário (pelo lead ou pela cliente na mesma hora) fica de fora.
 */
export type ScheduledPlanItem = {
  dealId: string; contactId: string; clientName: string; startsAt: string; serviceId: string | null; serviceLabel: string;
  professionalId: string | null; durationMin: number | null; bufferMin: number | null; status: "agendado" | "confirmado"; confirmedAt: string | null;
};
export type ScheduledSkip = { dealId: string; clientName: string; startsAt: string; reason: "passou" | "ja_na_agenda" };
export type ScheduledPlan = { at: string; items: ScheduledPlanItem[]; skipped: ScheduledSkip[] };

const LIVE = notInArray(appointments.status, ["cancelado", "espera"]);

export async function planScheduledMigration(now = new Date()): Promise<ScheduledPlan> {
  const rows = await db.select({
    dealId: deals.id, contactId: deals.contactId, name: contacts.name, startsAt: deals.scheduledAt, serviceId: deals.serviceId, serviceLabel: lists.label,
    durationMin: lists.durationMin, bufferMin: lists.bufferMin, professionalId: deals.professionalId, attendance: deals.attendance, attendanceAt: deals.attendanceAt,
  }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId)).leftJoin(lists, eq(lists.id, deals.serviceId))
    .where(and(eq(stages.kind, "agendado"), isNull(deals.archivedAt), isNotNull(deals.scheduledAt))).orderBy(asc(deals.scheduledAt));
  const plan: ScheduledPlan = { at: now.toISOString(), items: [], skipped: [] };
  for (const r of rows) {
    const startsAt = r.startsAt!;
    const clientName = r.name?.trim() || "Cliente";
    const base = { dealId: r.dealId, clientName, startsAt: startsAt.toISOString() };
    if (startsAt < now) { plan.skipped.push({ ...base, reason: "passou" }); continue; }
    const [has] = await db.select({ id: appointments.id }).from(appointments)
      .where(and(or(eq(appointments.dealId, r.dealId), and(eq(appointments.contactId, r.contactId), eq(appointments.startsAt, startsAt))), isNull(appointments.avecTwinOf), LIVE)).limit(1);
    if (has) { plan.skipped.push({ ...base, reason: "ja_na_agenda" }); continue; }
    plan.items.push({
      ...base, contactId: r.contactId, serviceId: r.serviceId, serviceLabel: r.serviceLabel ?? "Atendimento", professionalId: r.professionalId,
      durationMin: r.durationMin ?? null, bufferMin: r.bufferMin ?? null,
      status: r.attendance === "confirmado" ? "confirmado" : "agendado", confirmedAt: r.attendance === "confirmado" ? (r.attendanceAt?.toISOString() ?? null) : null,
    });
  }
  return plan;
}

export async function applyScheduledMigration(plan: ScheduledPlan, now = new Date()): Promise<{ createdIds: string[]; fitIn: number; skipped: number }> {
  const createdIds: string[] = [];
  const days = new Set<string>();
  let fitIn = 0, skipped = 0;
  for (const it of plan.items) {
    const done = await db.transaction(async (tx) => {
      const start = new Date(it.startsAt);
      const day = dayOf(start);
      await lockAgendaTx(tx, { professionalIds: [it.professionalId], contactId: it.contactId, days: [day] });
      const [dup] = await tx.select({ id: appointments.id }).from(appointments)
        .where(and(or(eq(appointments.dealId, it.dealId), and(eq(appointments.contactId, it.contactId), eq(appointments.startsAt, start))), isNull(appointments.avecTwinOf), LIVE)).limit(1);
      if (dup) return null;
      // `now: start`: a conferência nunca diz "passou" para um horário combinado; só aponta conflito e fora do horário.
      const check = it.professionalId && it.durationMin != null
        ? await checkSlotTx(tx, { professionalId: it.professionalId, startsAt: start, durationMin: it.durationMin, bufferMin: it.bufferMin, clientId: it.contactId, now: start })
        : null;
      const fit = !!check && (!check.ok || check.fitIn);
      const outside = !!check?.ok && check.outsideHours;
      const visitId = await visitForDayTx(tx, { contactId: it.contactId, clientName: it.clientName }, day, null, now);
      const id = randomUUID();
      await tx.insert(appointments).values({
        id, externalKey: `crm:${id}`, origin: "crm", visitId, contactId: it.contactId, clientName: it.clientName, professionalId: it.professionalId,
        serviceId: it.serviceId, serviceLabel: it.serviceLabel, startsAt: start, durationMin: it.durationMin, bufferMin: it.bufferMin, status: it.status,
        dealId: it.dealId, fitIn: fit, outsideHours: outside, confirmedAt: it.confirmedAt ? new Date(it.confirmedAt) : null, confirmedVia: it.confirmedAt ? "recepcao" : null,
      });
      await tx.insert(auditLog).values({ userId: null, action: "agenda_migrado_do_lead", entity: "appointment", entityId: id, data: { dealId: it.dealId } });
      return { id, fit, day };
    });
    if (!done) { skipped++; continue; }
    createdIds.push(done.id);
    if (done.fit) fitIn++;
    days.add(done.day);
  }
  await afterAgendaChange(days);
  return { createdIds, fitIn, skipped };
}

/** Desfaz pela lista do backup: tira os horários que ninguém mexeu (sem `updated_by`, ainda agendado ou confirmado) e as visitas que ficaram vazias. */
export async function undoScheduledMigration(ids: string[]): Promise<{ removed: number; kept: number }> {
  if (!ids.length) return { removed: 0, kept: 0 };
  return db.transaction(async (tx) => {
    const gone = await tx.delete(appointments)
      .where(and(inArray(appointments.id, ids), eq(appointments.origin, "crm"), isNull(appointments.updatedBy), inArray(appointments.status, ["agendado", "confirmado"])))
      .returning({ id: appointments.id, visitId: appointments.visitId });
    const visitIds = [...new Set(gone.map((g) => g.visitId).filter((v): v is string => !!v))];
    if (visitIds.length) await tx.delete(visits).where(and(inArray(visits.id, visitIds), sql`not exists (select 1 from ${appointments} where ${appointments.visitId} = ${visits.id})`));
    await tx.insert(auditLog).values({ userId: null, action: "agenda_migracao_desfeita", entity: "appointment", data: { removidos: gone.length, mantidos: ids.length - gone.length } });
    return { removed: gone.length, kept: ids.length - gone.length };
  });
}
