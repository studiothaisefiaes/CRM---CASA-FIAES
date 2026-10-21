import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { alias } from "drizzle-orm/pg-core";
import { appointments, contacts, deals, lists, professionals } from "../db/schema";
import { firstName } from "@/lib/authorship";
import type { ReplyVars } from "@/lib/quick-reply";
import { messageDay, messageHour } from "@/lib/client-link";

/** Até quanto tempo para a frente um horário vale (regra do Lote 0: datas absurdas do Avec ficam de fora). */
const FUTURE_MAX_MS = 180 * 86_400_000;

/** {data_horario}: "quinta-feira, 22/10 às 15h" (Salvador), o mesmo formato do lembrete (21/10). */
export const slotLabel = (at: Date): string => `${messageDay(at)} às ${messageHour(at)}`;
/** "MAIARA" (apelido do Avec) → "Maiara". */
const nice = (s: string | null | undefined) => (s?.trim() ? s.trim().toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : null);

/** Valores das variáveis na conversa: o horário marcado no lead; sem ele, o próximo horário da cliente na agenda (Avec ou CRM). {meu_nome} vem de quem vê (getDealDetail). */
export async function replyVarsOf(dealId: string, now = new Date()): Promise<ReplyVars> {
  const service = alias(lists, "service");
  const [row] = await db.select({ name: contacts.name, contactId: contacts.id, scheduledAt: deals.scheduledAt, proName: professionals.name, serviceName: service.label })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).leftJoin(professionals, eq(professionals.id, deals.professionalId))
    .leftJoin(service, eq(service.id, deals.serviceId))
    .where(eq(deals.id, dealId));
  if (!row) return { primeiroNome: null, dataHorario: null, profissional: null, servico: null };
  const primeiroNome = firstName(row.name);
  const max = new Date(now.getTime() + FUTURE_MAX_MS);
  if (row.scheduledAt && row.scheduledAt > now && row.scheduledAt <= max) return { primeiroNome, dataHorario: slotLabel(row.scheduledAt), profissional: nice(row.proName), servico: row.serviceName?.trim() || null };
  const [appt] = await db.select({ startsAt: appointments.startsAt, proName: professionals.name, serviceLabel: appointments.serviceLabel }).from(appointments)
    .leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.contactId, row.contactId), gt(appointments.startsAt, now), lte(appointments.startsAt, max), inArray(appointments.status, ["agendado", "confirmado"])))
    .orderBy(asc(appointments.startsAt)).limit(1);
  return { primeiroNome, dataHorario: appt ? slotLabel(appt.startsAt) : null, profissional: nice(appt?.proName), servico: appt?.serviceLabel?.trim() || null };
}
