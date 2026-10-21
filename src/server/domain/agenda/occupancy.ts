import { and, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { Db, Tx } from "../../db";
import { appointmentAssistants, appointments, contacts, deals, lists, professionals, stages } from "../../db/schema";
import { minuteOfDay } from "../../../lib/agenda";

/** Status de horário que ocupam a agenda (spec §4.3): a lista mora em src/lib/appointment-status.ts (a tela usa a mesma). */
import { OCCUPYING_STATUSES } from "../../../lib/appointment-status";
import { isHiddenNumber } from "@/lib/phone-client";
export { OCCUPYING_STATUSES };

/** Um horário que ocupa a agenda: da tabela de horários (Avec ou CRM) ou um lead antigo com hora marcada e sem horário na agenda. */
export type OccupiedRow = {
  id: string; kind: "horario" | "lead"; professionalId: string | null; professionalName: string | null; contactId: string | null; clientName: string;
  serviceLabel: string | null; startsAt: Date; /** do horário, senão do serviço; null = desconhecida */ durationMin: number | null; /** folga do serviço (vazio = 0) */ bufferMin: number;
  /** o serviço "pode ser feito junto com outro" (0084); null = não informado */ parallelOk: boolean | null;
};

const svc = alias(lists, "svc");

/**
 * O que ocupa a agenda com início em [from, to): das profissionais pedidas (ou de todas, "all") e/ou da cliente. Fica de fora o horário
 * que está sendo remarcado (`ignoreAppointmentId`) e o "sem hora" do Avec (gravado às 00:00). Os leads com `scheduled_at` entram enquanto
 * o script do 6B não os leva para a agenda: sem os perdidos, os que faltaram ou remarcaram e os que já têm horário (pelo lead ou pela
 * mesma cliente no mesmo minuto).
 */
export async function loadOccupied(tx: Tx | Db, o: {
  from: Date; to: Date; professionalIds?: string[] | "all"; contactId?: string | null; ignoreAppointmentId?: string | null;
}): Promise<OccupiedRow[]> {
  const who = (proCol: PgColumn, contactCol: PgColumn): SQL => {
    const parts: SQL[] = [];
    if (o.professionalIds === "all") parts.push(sql`true`);
    else if (o.professionalIds?.length) parts.push(inArray(proCol, o.professionalIds));
    if (o.contactId) parts.push(eq(contactCol, o.contactId));
    return parts.length ? or(...parts)! : sql`false`;
  };
  // Uma consulta de cada vez: quem chama pode estar numa transação (uma conexão só).
  const aps = await tx.select({
      id: appointments.id, professionalId: appointments.professionalId, professionalName: professionals.name, contactId: appointments.contactId,
      contactName: contacts.name, clientName: appointments.clientName, serviceLabel: appointments.serviceLabel, startsAt: appointments.startsAt,
      own: appointments.durationMin, serviceDuration: svc.durationMin, buffer: svc.bufferMin, parallelOk: svc.parallelOk, origin: appointments.origin,
    }).from(appointments)
      .leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .leftJoin(svc, eq(svc.id, appointments.serviceId))
      .where(and(gte(appointments.startsAt, o.from), lt(appointments.startsAt, o.to), inArray(appointments.status, [...OCCUPYING_STATUSES]), isNull(appointments.avecTwinOf),
        who(appointments.professionalId, appointments.contactId), o.ignoreAppointmentId ? ne(appointments.id, o.ignoreAppointmentId) : undefined));
  // 0089: a auxiliar ocupa a agenda dela no período do horário. Só quando as profissionais vêm pela lista (com "all" a principal já traz
  // o horário); sem a cliente (a principal já conta para ela) e sem o horário que está sendo remarcado (as auxiliares vão junto).
  const aux = Array.isArray(o.professionalIds) && o.professionalIds.length ? await tx.select({
      id: appointments.id, professionalId: appointmentAssistants.professionalId, professionalName: professionals.name,
      contactName: contacts.name, clientName: appointments.clientName, serviceLabel: appointments.serviceLabel, startsAt: appointments.startsAt,
      own: appointments.durationMin, serviceDuration: svc.durationMin, buffer: svc.bufferMin, parallelOk: svc.parallelOk, origin: appointments.origin,
    }).from(appointmentAssistants).innerJoin(appointments, eq(appointments.id, appointmentAssistants.appointmentId))
      .leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .leftJoin(svc, eq(svc.id, appointments.serviceId))
      .where(and(gte(appointments.startsAt, o.from), lt(appointments.startsAt, o.to), inArray(appointments.status, [...OCCUPYING_STATUSES]), isNull(appointments.avecTwinOf),
        inArray(appointmentAssistants.professionalId, o.professionalIds), o.ignoreAppointmentId ? ne(appointments.id, o.ignoreAppointmentId) : undefined)) : [];
  const leads = await tx.select({
      id: deals.id, professionalId: deals.professionalId, professionalName: professionals.name, contactId: deals.contactId, contactName: contacts.name,
      phone: contacts.phoneE164, serviceLabel: svc.label, startsAt: deals.scheduledAt, serviceDuration: svc.durationMin, buffer: svc.bufferMin, parallelOk: svc.parallelOk,
    }).from(deals)
      .innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
      .leftJoin(professionals, eq(professionals.id, deals.professionalId)).leftJoin(svc, eq(svc.id, deals.serviceId))
      .where(and(isNull(deals.archivedAt), eq(contacts.ignored, false), gte(deals.scheduledAt, o.from), lt(deals.scheduledAt, o.to), ne(stages.kind, "perdido"),
        or(isNull(deals.attendance), notInArray(deals.attendance, ["faltou", "remarcou"])), who(deals.professionalId, deals.contactId),
        sql`not exists (select 1 from ${appointments} a where a.deal_id = ${deals.id} or (a.contact_id = ${deals.contactId} and a.starts_at = ${deals.scheduledAt}))`));
  const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);
  return [
    ...aps.filter((a) => !(a.origin === "avec" && minuteOfDay(a.startsAt) === 0)).map((a): OccupiedRow => ({
      id: a.id, kind: "horario", professionalId: a.professionalId, professionalName: a.professionalName, contactId: a.contactId,
      clientName: a.contactName?.trim() || a.clientName?.trim() || "Sem nome", serviceLabel: a.serviceLabel, startsAt: a.startsAt,
      durationMin: positive(a.own) ?? positive(a.serviceDuration), bufferMin: Math.max(0, a.buffer ?? 0), parallelOk: a.parallelOk ?? null,
    })),
    ...aux.map((a): OccupiedRow => ({
      id: a.id, kind: "horario", professionalId: a.professionalId, professionalName: a.professionalName, contactId: null,
      clientName: a.contactName?.trim() || a.clientName?.trim() || "Sem nome", serviceLabel: a.serviceLabel, startsAt: a.startsAt,
      durationMin: positive(a.own) ?? positive(a.serviceDuration), bufferMin: Math.max(0, a.buffer ?? 0), parallelOk: a.parallelOk ?? null,
    })),
    ...leads.map((l): OccupiedRow => ({
      id: l.id, kind: "lead", professionalId: l.professionalId, professionalName: l.professionalName, contactId: l.contactId,
      clientName: l.contactName?.trim() || (l.phone && !isHiddenNumber(l.phone) ? l.phone : "Sem nome"), serviceLabel: l.serviceLabel, startsAt: l.startsAt!,
      durationMin: positive(l.serviceDuration), bufferMin: Math.max(0, l.buffer ?? 0), parallelOk: l.parallelOk ?? null,
    })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
