import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { activePurchaseSql } from "./package-purchase-sql";
import { db } from "../db";
import { agendaBlocks, appointments, clientNotes, contacts, lists, professionals, professionalServices, salesItems, users } from "../db/schema";
import { effectiveRanges, type WorkHours } from "@/lib/work-hours";
import { blockAppliesOn } from "@/lib/agenda-blocks";
import { dayOf, hmToMinutes, shiftDay, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { firstName } from "@/lib/authorship";
import { packageLine } from "@/lib/client-avec";
import { isUuid } from "@/lib/uuid";
import { birthdayWithin, lastVisitLabel, minuteIn, PRO_VISIBLE_STATUSES } from "@/lib/pro-day";
import { getBusinessHours } from "../domain/hours";
import { isFuncaoOn } from "../domain/funcoes";

/** A profissional da sessão. Toda leitura e ação do app usa esta, resolvida no servidor (a tela nunca escolhe). */
export type ProContext = { professionalId: string; userId: string; name: string; workHours: WorkHours | null };

/** A profissional ativa ligada a esta usuária; sem ligação (ou desativada), null. */
export async function resolvePro(userId: string): Promise<ProContext | null> {
  const [p] = await db.select({ id: professionals.id, name: professionals.name, workHours: professionals.workHours })
    .from(professionals).where(and(eq(professionals.userId, userId), eq(professionals.active, true))).limit(1);
  return p ? { professionalId: p.id, userId, name: p.name, workHours: (p.workHours as WorkHours | null) ?? null } : null;
}

export type ProItem = { id: string; startsAt: string; start: number; durationMin: number | null; status: string; clientName: string; contactId: string | null; service: string; notes: string | null };
export type ProBlock = { id: string; title: string; start: number; end: number; pending: boolean };
export type ProDay = { day: string; ranges: [number, number][]; items: ProItem[]; blocks: ProBlock[] };
export type NoteView = { id: string; body: string; at: string; author: string | null; hasPhoto: boolean };
export type ClientCard = { notes: NoteView[]; lastVisit: string | null; pkg: string | null; firstVisit: boolean; birthdayThisWeek: boolean };
/** Um horário dela com o cartão da cliente (em `card`: a ficha técnica não pode colidir com a observação do horário, `notes`). */
export type ProAppointment = ProItem & { card: ClientCard; day: string; visitId: string | null };
export type ProWeekDay = { day: string; clients: number; off: boolean };

const bounds = (first: string, days = 1) => ({ from: new Date(slotMs(first, "00:00")), to: new Date(slotMs(shiftDay(first, days), "00:00")) });

/** Campos que a profissional pode ver de um horário (nunca telefone, e-mail ou valor). */
const itemCols = {
  id: appointments.id, startsAt: appointments.startsAt, own: appointments.durationMin, svc: lists.durationMin, status: appointments.status,
  clientName: appointments.clientName, contactName: contacts.name, contactId: appointments.contactId, service: appointments.serviceLabel, notes: appointments.notes,
  visitId: appointments.visitId,
};
type ItemRow = { id: string; startsAt: Date; own: number | null; svc: number | null; status: string; clientName: string | null; contactName: string | null; contactId: string | null; service: string; notes: string | null; visitId: string | null };
const toItem = (r: ItemRow): ProItem => ({
  id: r.id, startsAt: r.startsAt.toISOString(), start: minuteIn(r.startsAt.getTime()), durationMin: r.own ?? r.svc ?? null, status: r.status,
  clientName: r.contactName?.trim() || r.clientName?.trim() || "Cliente", contactId: r.contactId, service: r.service, notes: r.notes,
});
const mine = (pro: ProContext) => and(eq(appointments.professionalId, pro.professionalId), isNull(appointments.avecTwinOf), inArray(appointments.status, [...PRO_VISIBLE_STATUSES]));

/** O dia dela: horários (sem cancelado, lista de espera e gêmeo), bloqueios que valem no dia (dela e de todas) e as faixas de trabalho. */
export async function getProDay(pro: ProContext, day: string): Promise<ProDay> {
  const { from, to } = bounds(day);
  const [hours, rows, blockRows] = await Promise.all([
    getBusinessHours(),
    db.select(itemCols).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(lists, eq(lists.id, appointments.serviceId))
      .where(and(mine(pro), gte(appointments.startsAt, from), lt(appointments.startsAt, to))).orderBy(asc(appointments.startsAt)),
    db.select().from(agendaBlocks).where(and(
      or(eq(agendaBlocks.professionalId, pro.professionalId), isNull(agendaBlocks.professionalId)), isNull(agendaBlocks.deletedAt),
      or(isNull(agendaBlocks.requestStatus), ne(agendaBlocks.requestStatus, "recusado")), lte(agendaBlocks.startsOn, day), gte(agendaBlocks.endsOn, day))),
  ]);
  const blocks = blockRows.filter((b) => blockAppliesOn({ startsOn: b.startsOn, endsOn: b.endsOn, weekdays: b.weekdays }, day)).flatMap((b): ProBlock[] => {
    const s = hmToMinutes(b.startTime), e = hmToMinutes(b.endTime);
    if (s == null || e == null || e <= s) return [];
    const pending = b.requestStatus === "pedido";
    return [{ id: b.id, title: pending ? `${b.title} (aguardando a recepção)` : b.title, start: s, end: e, pending }];
  }).sort((a, b) => a.start - b.start);
  return { day, ranges: effectiveRanges(day, pro.workHours, hours), items: (rows as ItemRow[]).map(toItem), blocks };
}

/** Anotações da ficha técnica (não as do contato), da mais nova para a mais velha. */
export async function listClientNotes(contactId: string, limit = 5): Promise<NoteView[]> {
  const rows = await db.select({ id: clientNotes.id, body: clientNotes.body, at: clientNotes.createdAt, author: users.name, photo: clientNotes.mediaPath })
    .from(clientNotes).leftJoin(users, eq(users.id, clientNotes.authorId))
    .where(and(eq(clientNotes.contactId, contactId), isNull(clientNotes.deletedAt))).orderBy(desc(clientNotes.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, body: r.body, at: r.at.toISOString(), author: firstName(r.author), hasPhoto: !!r.photo }));
}

/** O cartão da cliente: ficha técnica, última visita (data, serviço e profissional, sem valor), pacote, "primeira vez" e "aniversário esta semana". */
export async function clientCard(item: { contactId: string | null; startsAt: string }, now: Date): Promise<ClientCard> {
  if (!item.contactId) return { notes: [], lastVisit: null, pkg: null, firstVisit: false, birthdayThisWeek: false };
  const c = item.contactId;
  const today = todayBahia(now);
  const [notes, last, sold, pkgs, who] = await Promise.all([
    listClientNotes(c, 3),
    db.select({ startsAt: appointments.startsAt, service: appointments.serviceLabel, pro: professionals.name }).from(appointments)
      .leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(and(eq(appointments.contactId, c), eq(appointments.status, "compareceu"), lt(appointments.startsAt, new Date(item.startsAt)), isNull(appointments.avecTwinOf)))
      .orderBy(desc(appointments.startsAt)).limit(1),
    db.select({ id: salesItems.id }).from(salesItems).where(eq(salesItems.contactId, c)).limit(1),
    // Pacote cancelado no CRM (`cancelled_at`, 6C) não aparece.
    db.execute(sql`select pk.package_name as "packageName", pk.used_sessions as "usedSessions", pk.total_sessions as "totalSessions"
      from ${activePurchaseSql(sql`${c}::uuid`, sql`${today}::date`, { skipCancelled: true })} pk`),
    db.select({ day: contacts.birthDay, month: contacts.birthMonth }).from(contacts).where(eq(contacts.id, c)),
  ]);
  const p = pkgs.rows[0] as { packageName: string; usedSessions: number; totalSessions: number } | undefined;
  return {
    notes,
    lastVisit: last[0] ? lastVisitLabel({ startsAt: last[0].startsAt, service: last[0].service, professional: last[0].pro }) : null,
    pkg: p ? packageLine(p) : null,
    firstVisit: !last[0] && !sold[0],
    birthdayThisWeek: birthdayWithin(who[0]?.day ?? null, who[0]?.month ?? null, today),
  };
}

/** Um horário dela. De outra profissional, gêmeo do Avec ou id inválido: null ("Horário não encontrado"). */
export async function getProAppointment(pro: ProContext, id: string, now: Date): Promise<ProAppointment | null> {
  if (!isUuid(id)) return null;
  const [r] = await db.select(itemCols).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(lists, eq(lists.id, appointments.serviceId))
    .where(and(eq(appointments.id, id), mine(pro)));
  if (!r) return null;
  const item = toItem(r as ItemRow);
  return { ...item, card: await clientCard(item, now), day: dayOf(r.startsAt), visitId: r.visitId };
}

/** A semana dela: 7 dias a partir de `fromDay`, com o número de clientes (faltou não conta) e a folga. */
export async function getProWeek(pro: ProContext, fromDay: string): Promise<ProWeekDay[]> {
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(fromDay, i));
  const { from, to } = bounds(fromDay, 7);
  const [hours, rows] = await Promise.all([
    getBusinessHours(),
    db.select({ startsAt: appointments.startsAt }).from(appointments).where(and(mine(pro), ne(appointments.status, "faltou"), gte(appointments.startsAt, from), lt(appointments.startsAt, to))),
  ]);
  const count = new Map<string, number>();
  for (const r of rows) { const d = dayOf(r.startsAt); count.set(d, (count.get(d) ?? 0) + 1); }
  return days.map((day) => ({ day, clients: count.get(day) ?? 0, off: effectiveRanges(day, pro.workHours, hours).length === 0 }));
}

/** Os serviços que ela faz, com o preço do cadastro ("Fez algo a mais?"): o próprio dela (0084, com a função ligada), senão o do serviço. */
export async function listMyServices(pro: ProContext): Promise<{ id: string; label: string; priceCents: number | null }[]> {
  const own = await isFuncaoOn("preco_por_profissional");
  const rows = await db.select({ id: lists.id, label: lists.label, priceCents: lists.priceCents, ownPrice: professionalServices.priceCents }).from(professionalServices).innerJoin(lists, eq(lists.id, professionalServices.serviceId))
    .where(and(eq(professionalServices.professionalId, pro.professionalId), eq(lists.active, true))).orderBy(asc(lists.label));
  return rows.map((r) => ({ id: r.id, label: r.label, priceCents: (own ? r.ownPrice : null) ?? r.priceCents }));
}
