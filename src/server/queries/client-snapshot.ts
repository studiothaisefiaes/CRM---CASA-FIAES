import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, contactStats, contacts, deals, professionals, stages } from "../db/schema";
import { listClientPackages, nextAppointmentsOf, type AppointmentItem } from "./avec";
import { lateExists } from "./late-count";
import { teamNameOf } from "./team-name";
import { normText } from "../domain/avec/normalize";
import { clientSituation, type Situation } from "../../lib/client-situation";
import { FUTURE_HORIZON_DAYS } from "../../lib/client-rhythm";
import { isUuid } from "../../lib/uuid";

const DAY = 86_400_000;

/** A cliente agora, para a ficha e para o painel da conversa (Lote 2). Valores em centavos só com `money`. */
export type ClientSnapshot = {
  contactId: string;
  stats: {
    visits: number; firstVisitOn: string | null; lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null;
    noShows: number; cancellations: number; serviceCount: number; topServices: { item: string; n: number }[];
    totalCents: number | null; ticketCents: number | null; computedAt: string | null;
  };
  situation: Situation;
  preferred: { id: string | null; name: string; source: "ficha" | "calculada" | "avec"; share: number | null } | null;
  /** "Como conheceu" (Avec) ou a origem do primeiro lead; null = não identificada. */
  origin: string | null;
  avecProfessionalHint: string | null;
  finance: { debtCount: number; debtCents: number | null; lastDebtOn: string | null; creditCount: number; creditCents: number | null };
  conversation: {
    dealId: string; stageName: string; stageKind: string; ownerName: string | null; lastReplyName: string | null; lastReplyVia: "celular" | "crm" | null;
    enteredAt: string; awaitingSince: string | null; late: boolean; closedConversation: boolean; nextAction: { title: string; dueAt: string } | null;
  } | null;
  nextAppointment: AppointmentItem | null;
  /** Todos os horários da visita do próximo horário (a cliente pode ser atendida por várias profissionais ao mesmo tempo; assistente marcada à parte). */
  nextVisit?: { serviceLabel: string; professionalName: string | null; startsAt: string; assistant: boolean }[];
  activePackage: { packageName: string; usedSessions: number; totalSessions: number } | null;
  birthday: { day: number; month: number; year: number | null } | null;
  /** O mais antigo entre a primeira visita, o "cliente desde" do Avec, a primeira mensagem e o primeiro lead. */
  knownSince: string | null;
  alertNotes: string | null;
};

export async function getClientSnapshot(contactId: string, opts: { money: boolean; now?: Date }): Promise<ClientSnapshot | null> {
  if (!isUuid(contactId)) return null;
  const now = opts.now ?? new Date();
  const [row] = await db.select({ c: contacts, s: contactStats, chosen: professionals.name }).from(contacts)
    .leftJoin(contactStats, eq(contactStats.contactId, contacts.id))
    .leftJoin(professionals, eq(professionals.id, contacts.preferredProfessionalId))
    .where(eq(contacts.id, contactId));
  if (!row) return null;
  const { c, s } = row;
  const [[open], nextMap, [pkg], [first], pros] = await Promise.all([
    db.select({
      id: deals.id, stageName: stages.name, stageKind: stages.kind,
      ownerName: teamNameOf(deals.ownerId), lastReplyName: teamNameOf(deals.lastReplyById), lastReplyVia: deals.lastReplyVia,
      enteredAt: deals.stageEnteredAt, awaitingSince: deals.awaitingReplySince, closedConversation: sql<boolean>`(${deals.conversationArchivedAt} is not null)`,
      late: sql<boolean>`${lateExists(deals.id)}`,
      nextTitle: sql<string | null>`(select t.title from tasks t where t.deal_id = ${deals.id} and t.kind = 'proxima_acao' and t.done_at is null order by t.due_at limit 1)`,
      nextDue: sql<string | null>`(select t.due_at from tasks t where t.deal_id = ${deals.id} and t.kind = 'proxima_acao' and t.done_at is null order by t.due_at limit 1)`,
    }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).limit(1),
    nextAppointmentsOf([contactId], now),
    listClientPackages({ contactId, situacao: "ativos" }, now),
    db.execute(sql`select least((select min(m.created_at) from messages m where m.contact_id = ${contactId}),
                                (select min(d.created_at) from deals d where d.contact_id = ${contactId})) as first`).then((r) => r.rows as { first: string | Date | null }[]),
    s?.avecProfessionalHint ? db.select({ id: professionals.id, name: professionals.name }).from(professionals) : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // Horário a mais de 180 dias (data absurda do Avec) não é "próximo horário".
  const nextRaw = nextMap.get(contactId) ?? null;
  const next = nextRaw && Date.parse(nextRaw.startsAt) <= now.getTime() + FUTURE_HORIZON_DAYS * DAY ? nextRaw : null;

  // A visita inteira (20/10: atendida por 4 profissionais, o painel mostrava só uma). A assistente aparece como assistente, nunca como quem atende.
  const visitRows = next?.visitId
    ? await db.select({ serviceLabel: appointments.serviceLabel, startsAt: appointments.startsAt, proName: professionals.name, assistantOf: professionals.assistantOf })
      .from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(and(eq(appointments.visitId, next.visitId), inArray(appointments.status, ["agendado", "confirmado", "chegou", "em_atendimento"]), isNull(appointments.avecTwinOf)))
      .orderBy(asc(appointments.startsAt), asc(appointments.serviceLabel))
    : [];
  const nextVisit = visitRows.map((v) => ({ serviceLabel: v.serviceLabel, professionalName: v.proName ?? null, startsAt: v.startsAt.toISOString(), assistant: !!v.assistantOf }));

  const preferred: ClientSnapshot["preferred"] = c.preferredProfessionalId && row.chosen
    ? { id: c.preferredProfessionalId, name: row.chosen, source: "ficha", share: null }
    : s?.preferredProfessionalName
      ? { id: s.preferredProfessionalId, name: s.preferredProfessionalName, source: "calculada", share: s.preferredShare }
      : s?.avecProfessionalHint
        ? { id: pros.find((p) => normText(p.name) === normText(s.avecProfessionalHint))?.id ?? null, name: s.avecProfessionalHint, source: "avec", share: null }
        : null;

  const since = [s?.firstVisitOn ? Date.parse(`${s.firstVisitOn}T15:00:00Z`) : null, c.clientSince?.getTime() ?? null, first?.first ? new Date(first.first).getTime() : null]
    .filter((x): x is number => x != null);

  const conversation: ClientSnapshot["conversation"] = open ? {
    dealId: open.id, stageName: open.stageName, stageKind: open.stageKind, ownerName: open.ownerName, lastReplyName: open.lastReplyName,
    lastReplyVia: open.lastReplyVia ?? null, enteredAt: open.enteredAt.toISOString(), awaitingSince: open.awaitingSince?.toISOString() ?? null,
    late: !!open.late, closedConversation: !!open.closedConversation,
    nextAction: open.nextTitle && open.nextDue ? { title: open.nextTitle, dueAt: new Date(open.nextDue).toISOString() } : null,
  } : null;

  const situation = clientSituation({
    lastVisitOn: s?.lastVisitOn ?? null, rhythmDays: s?.rhythmDays ?? null, cycleDays: s?.cycleDays ?? null,
    nextAppointment: next ? { startsAt: next.startsAt, professionalName: next.professionalName } : null,
    activePackage: pkg ? { usedSessions: pkg.usedSessions, totalSessions: pkg.totalSessions } : null,
    // Conversa encerrada não entra na frase (a ficha mostra no bloco Agora).
    conversation: conversation && !conversation.closedConversation ? conversation : null,
    birthday: c.birthDay && c.birthMonth ? { day: c.birthDay, month: c.birthMonth } : null,
  }, now.getTime());

  const money = opts.money;
  return {
    contactId,
    stats: {
      visits: s?.visits ?? 0, firstVisitOn: s?.firstVisitOn ?? null, lastVisitOn: s?.lastVisitOn ?? null,
      rhythmDays: s?.rhythmDays ?? null, cycleDays: s?.cycleDays ?? null, noShows: s?.noShows ?? 0, cancellations: s?.cancellations ?? 0,
      serviceCount: s?.serviceCount ?? 0, topServices: s?.topServices ?? [],
      totalCents: money ? s?.totalCents ?? 0 : null,
      ticketCents: money && s && s.tickets > 0 && s.totalCents != null ? Math.round(s.totalCents / s.tickets) : null,
      computedAt: s?.computedAt?.toISOString() ?? null,
    },
    situation, preferred, origin: s?.originLabel ?? null, avecProfessionalHint: s?.avecProfessionalHint ?? null,
    finance: {
      debtCount: s?.debtCount ?? 0, debtCents: money ? s?.debtCents ?? 0 : null, lastDebtOn: s?.lastDebtOn ?? null,
      creditCount: s?.creditCount ?? 0, creditCents: money ? s?.creditCents ?? 0 : null,
    },
    conversation,
    nextAppointment: next,
    nextVisit,
    activePackage: pkg ? { packageName: pkg.packageName, usedSessions: pkg.usedSessions, totalSessions: pkg.totalSessions } : null,
    birthday: c.birthDay && c.birthMonth ? { day: c.birthDay, month: c.birthMonth, year: c.birthYear } : null,
    knownSince: since.length ? new Date(Math.min(...since)).toISOString() : null,
    alertNotes: c.alertNotes,
  };
}
