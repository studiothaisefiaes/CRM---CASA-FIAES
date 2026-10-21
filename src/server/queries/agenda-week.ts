import { displayName } from "@/lib/display-name";
import { and, asc, gte, inArray, isNull, lt, sql, eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, lists, professionals } from "../db/schema";
import { weekDays, dayOf, type AgendaRange } from "@/lib/agenda";
import { OCCUPYING_STATUSES } from "@/lib/appointment-status";
import { effectiveRanges } from "@/lib/work-hours";
import { normText } from "../domain/avec/normalize";
import { getBusinessHours } from "../domain/hours";
import { getAgendaRules } from "../domain/agenda/mode";

export type WeekCell = { day: string; clients: number; minutes: number; off: boolean };
export type WeekRow = { professionalId: string; name: string; active: boolean; cells: WeekCell[] };

/**
 * Semana por profissional (6.1): uma linha por profissional (as ativas, mais quem tem horário na semana) e uma coluna por dia, com o
 * número de clientes e as horas marcadas, ou "Folga" quando ela não trabalha no dia (horário próprio, senão o da Casa).
 */
export async function getAgendaWeekByPro(range: AgendaRange): Promise<WeekRow[]> {
  const days = weekDays(range);
  const to = new Date(range.from.getTime() + range.days * 86_400_000);
  const [pros, casa, rows, step] = await Promise.all([
    db.select({ id: professionals.id, name: professionals.name, active: professionals.active, workHours: professionals.workHours })
      .from(professionals).orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name)),
    getBusinessHours(),
    db.select({ pro: appointments.professionalId, contactId: appointments.contactId, clientName: appointments.clientName, startsAt: appointments.startsAt,
      durationMin: appointments.durationMin, serviceDuration: lists.durationMin })
      .from(appointments).leftJoin(lists, eq(lists.id, appointments.serviceId))
      .where(and(gte(appointments.startsAt, range.from), lt(appointments.startsAt, to), inArray(appointments.status, [...OCCUPYING_STATUSES]), isNull(appointments.avecTwinOf))),
    getAgendaRules().then((r) => r.passoMin),
  ]);
  const busyPros = new Set(rows.map((r) => r.pro).filter(Boolean));
  return pros.filter((p) => p.active || busyPros.has(p.id)).map((p) => ({
    professionalId: p.id, name: displayName(p.name), active: p.active,
    cells: days.map((day) => {
      const mine = rows.filter((r) => r.pro === p.id && dayOf(r.startsAt) === day);
      return {
        day,
        clients: new Set(mine.map((r) => r.contactId ?? `nome:${normText(r.clientName)}`)).size,
        minutes: mine.reduce((a, r) => a + (r.durationMin ?? r.serviceDuration ?? step), 0),
        off: effectiveRanges(day, p.workHours, casa).length === 0,
      };
    }),
  }));
}
