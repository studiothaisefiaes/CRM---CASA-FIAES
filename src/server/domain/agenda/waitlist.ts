import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { appointments, auditLog, contacts, lists, professionals } from "../../db/schema";
import { UserFacingError } from "../errors";
import { assertProfessionalFor } from "../professionals";
import { dayOf, instantOf, minuteOfDay, todayBahia } from "@/lib/agenda";
import { hhmm } from "@/lib/free-slots";
import { WAIT_WINDOWS } from "@/lib/appointment-status";
import { assertCanBook } from "./mode";
import { afterAgendaChange } from "./notify";
import { cancelAppointmentsTx, createVisitTx, resolveClientTx, type ClientRef, type CreateVisitInput } from "./visits";
import type { Actor } from "./actor";

/**
 * Lista de espera (6.4, regra 13): o pedido fica como `espera`, no dia desejado às 00:00 (como o importado do Avec). "Encaixar" cria o
 * horário pela porta de marcar e o pedido vira `espera_encaixada`; "Desistiu" vira `espera_desistiu`. Nada se apaga, e a reimportação não
 * devolve o pedido para a espera (ele fica como mexido no CRM).
 */
export const addWaitlistSchema = z.object({
  client: z.custom<ClientRef>((v) => !!v && typeof v === "object", "Escolha a cliente."),
  serviceId: z.string().uuid().nullable(),
  professionalId: z.string().uuid().nullable(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha o dia."),
  window: z.enum(WAIT_WINDOWS, { message: "Escolha manhã, tarde ou dia todo." }),
  notes: z.string().trim().max(500, "Use até 500 caracteres.").nullable().optional(),
});
export type AddWaitlistInput = z.input<typeof addWaitlistSchema>;
export type ResolveWaitlistInput = { result: "encaixada"; booking: Omit<CreateVisitInput, "client"> } | { result: "desistiu"; note?: string | null };
export type WaitlistMatch = {
  id: string; contactId: string | null; clientName: string; serviceId: string | null; serviceLabel: string;
  professionalId: string | null; professionalName: string | null; window: string | null; notes: string | null; origin: string;
};

export async function addToWaitlist(raw: AddWaitlistInput, actor: Actor, now = new Date()): Promise<{ id: string }> {
  const input = addWaitlistSchema.parse(raw);
  if (input.day < todayBahia(now)) throw new UserFacingError("Escolha hoje ou um dia que ainda não passou.");
  const id = await db.transaction(async (tx) => {
    await assertCanBook(tx);
    const client = await resolveClientTx(tx, input.client);
    const [svc] = input.serviceId ? await tx.select({ label: lists.label }).from(lists).where(and(eq(lists.id, input.serviceId), eq(lists.kind, "service"))) : [];
    if (input.serviceId && !svc) throw new UserFacingError("Esse serviço não está mais na lista. Escolha outro.");
    if (input.professionalId) await assertProfessionalFor(tx, input.professionalId, input.serviceId);
    const newId = randomUUID();
    await tx.insert(appointments).values({
      id: newId, externalKey: `crm:esp:${newId}`, origin: "crm", contactId: client.id, clientName: client.name, professionalId: input.professionalId,
      serviceId: input.serviceId, serviceLabel: svc?.label ?? "Não informado", startsAt: instantOf(input.day, 0), status: "espera", waitWindow: input.window,
      notes: input.notes || null, createdBy: actor.id, updatedBy: actor.id, crmTouchedAt: now, createdAt: now, updatedAt: now,
    });
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_espera", entity: "appointment", entityId: newId, createdAt: now, data: { dia: input.day, janela: input.window } });
    return newId;
  });
  await afterAgendaChange([input.day]);
  return { id };
}

export async function resolveWaitlist(id: string, input: ResolveWaitlistInput, actor: Actor, now = new Date()): Promise<{ appointmentIds: string[] }> {
  const r = await db.transaction(async (tx) => {
    const [w] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
    if (!w || w.status !== "espera") throw new UserFacingError("Esse pedido já saiu da lista de espera.");
    const day = dayOf(w.startsAt);
    if (input.result === "desistiu") {
      const note = z.string().trim().max(200, "Use até 200 caracteres.").parse(input.note ?? "") || null;
      await tx.update(appointments).set({ status: "espera_desistiu", cancelNote: note, updatedBy: actor.id, updatedAt: now, crmTouchedAt: now }).where(eq(appointments.id, w.id));
      await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_espera_resolvida", entity: "appointment", entityId: w.id, createdAt: now, data: { de: "espera", para: "espera_desistiu" } });
      return { appointmentIds: [] as string[], days: [day], dealIds: [] as string[] };
    }
    if (!w.contactId) throw new UserFacingError("Esse pedido não tem a ficha da cliente: marque pelo botão Marcar.");
    const v = await createVisitTx(tx, { ...input.booking, client: { contactId: w.contactId } }, actor, now);
    await tx.update(appointments).set({ status: "espera_encaixada", waitResultAppointmentId: v.appointmentIds[0], updatedBy: actor.id, updatedAt: now, crmTouchedAt: now }).where(eq(appointments.id, w.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_espera_resolvida", entity: "appointment", entityId: w.id, createdAt: now,
      data: { de: "espera", para: "espera_encaixada", horario: v.appointmentIds[0] } });
    return { appointmentIds: v.appointmentIds, days: [day, v.day], dealIds: v.dealIds };
  });
  await afterAgendaChange(r.days, r.dealIds);
  return { appointmentIds: r.appointmentIds };
}

/** Quem está na espera para o dia: da profissional (ou qualquer uma) e do serviço (ou sem serviço), na ordem em que pediu. */
export async function waitlistMatchesFor(day: string, opts: { professionalId?: string | null; serviceId?: string | null } = {}): Promise<WaitlistMatch[]> {
  const rows = await db.select({
    id: appointments.id, contactId: appointments.contactId, clientName: appointments.clientName, contactName: contacts.name, serviceId: appointments.serviceId,
    serviceLabel: appointments.serviceLabel, professionalId: appointments.professionalId, professionalName: professionals.name, window: appointments.waitWindow,
    notes: appointments.notes, origin: appointments.origin,
  }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.status, "espera"), gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440)),
      opts.professionalId ? or(isNull(appointments.professionalId), eq(appointments.professionalId, opts.professionalId)) : undefined,
      opts.serviceId ? or(isNull(appointments.serviceId), eq(appointments.serviceId, opts.serviceId)) : undefined))
    .orderBy(asc(appointments.createdAt));
  return rows.map(({ contactName, ...r }) => ({ ...r, clientName: contactName?.trim() || r.clientName?.trim() || "Sem nome" }));
}

/**
 * Nova Agenda › Pendências › "Remarcar" (um ou em lote): o horário sem baixa sai da agenda (cancelado com o motivo "Remarcado") e a
 * cliente entra na lista de espera para hoje (ou para o dia do horário, se ainda não chegou), dia todo, com a mesma profissional só se
 * ela pediu ela. Nada é enviado para a cliente. No modo consulta, recusa (lista de espera é ocupação nova).
 */
export async function waitlistToReschedule(id: string, actor: Actor, now = new Date()): Promise<{ waitlistId: string; day: string }> {
  const r = await db.transaction(async (tx) => {
    await assertCanBook(tx);
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    if (a.status !== "agendado" && a.status !== "confirmado") throw new UserFacingError("Só vai para a lista um horário agendado ou confirmado.");
    const was = `${dayOf(a.startsAt).slice(8, 10)}/${dayOf(a.startsAt).slice(5, 7)} às ${hhmm(minuteOfDay(a.startsAt))}`;
    const c = await cancelAppointmentsTx(tx, { appointmentId: a.id, reason: "remarcado", note: "Foi para a lista de espera para remarcar" }, actor.id, now);
    const day = dayOf(a.startsAt) > todayBahia(now) ? dayOf(a.startsAt) : todayBahia(now);
    const newId = randomUUID();
    await tx.insert(appointments).values({
      id: newId, externalKey: `crm:esp:${newId}`, origin: "crm", contactId: a.contactId, clientName: a.clientName,
      professionalId: a.preference === "escolhida" ? a.professionalId : null, serviceId: a.serviceId, serviceLabel: a.serviceLabel,
      startsAt: instantOf(day, 0), status: "espera", waitWindow: "dia", notes: `Remarcar o horário de ${was}`,
      createdBy: actor.id, updatedBy: actor.id, crmTouchedAt: now, createdAt: now, updatedAt: now,
    });
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_espera", entity: "appointment", entityId: newId, createdAt: now, data: { dia: day, janela: "dia", remarcarDe: a.id } });
    return { waitlistId: newId, day, days: [c.day, day], dealIds: c.dealIds };
  });
  await afterAgendaChange(r.days, r.dealIds);
  return { waitlistId: r.waitlistId, day: r.day };
}
