import { isGenericClientName } from "@/lib/generic-client";
import { displayName } from "@/lib/display-name";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { agendaStatus, appointmentAgendaStatus, dayOf, entryDuration, minuteOfDay, type AgendaRange, type AgendaStatus } from "@/lib/agenda";
import { db } from "../db";
import { appointments, comandaItems, comandas, contacts, deals, lists, professionals, professionalServices, salesItems, stages, users } from "../db/schema";
import { listAppointments } from "./avec";
import { teamNameCol } from "./team-name";
import { photoVersionOf, proPhotoUrl } from "@/lib/pro-photo";
import type { Preference } from "@/lib/appointment-preference";
import type { VisitType } from "@/lib/visit-type";
import { getVisitTypes, visitTypeLabelMap } from "../domain/agenda/labels";
import { getFuncoes } from "../domain/funcoes";
import { auxiliariesOf } from "../domain/agenda/appointment-assistants";
import type { ImageUse } from "@/lib/client-alert";

export type AgendaItem = {
  /** Chave única na tela: "lead:<id>" ou "ag:<id>". */ key: string;
  /** lead = conversa em Agendado sem horário na agenda; agendamento = horário da agenda (Avec ou CRM). */ source: "lead" | "agendamento";
  dealId: string | null; appointmentId: string | null; visitId: string | null;
  contactId: string | null; name: string; phone: string | null; hasAvatar: boolean;
  scheduledAt: string; /** Do horário, senão do serviço; sem nenhuma, 60 min estimados. */ durationMin: number; durationEstimated: boolean;
  /** Cancelamento do Avec que veio sem hora (gravado às 00:00): a tela mostra "sem hora". */ noTime: boolean;
  service: string | null; serviceId: string | null; ownerName: string | null; professionalId: string | null; professionalName: string | null;
  /** Cor da profissional (6A, `professionals.color`): o card ganha um toque dela (6.10). */ professionalColor: string | null;
  /** Miniatura da profissional (6B.16). */ professionalPhotoUrl?: string | null;
  /** 6.11 */ preference?: Preference | null;
  stageName: string | null; status: AgendaStatus; /** O status gravado (só agendamentos): o card escolhe o próximo passo por ele. */ dbStatus: string | null;
  origin: "avec" | "crm"; notes: string | null; /** Quem marcou (CRM) ou "Quem cadastrou" (Avec). */ bookedBy: string | null;
  /** Comanda fechada (6C): selo R$. */ paid: boolean; /** Comanda aberta deste horário (6C): "falta fechar". */ openComandaId?: string | null; /** Nenhuma visita finalizada antes deste dia. */ firstVisit: boolean;
  anyPro: boolean; fitIn: boolean; outsideHours: boolean; confirmedVia: string | null; cancelReason: string | null;
  /** A CLIENTE PADRÃO do Avec (17/10): fica na grade, mas não pede baixa, não entra no Hoje nem na comanda. */ genericClient?: boolean;
  /** Gap Avec (A1): no Avec a reserva continua Agendado, sem baixa (o 0248). */ avecSemBaixa?: boolean;
  /** 0080: marcador do horário. "Primeira vez" não é marcador: a tela usa `firstVisit`. */ label?: { id: string; name: string; color: string | null } | null;
  /** 0081: avisos fixos da cliente (um por linha) e o uso de imagem dela, para o Aviso que salta. `imageUse` vem nulo com a função uso_imagem desligada. */ alertNotes?: string | null; imageUse?: ImageUse | null;
  /** 0080: tipo gravado (indicacao | noiva) e o rótulo em vigor (editável em Configurações). */ visitType?: VisitType | null; visitTypeLabel?: string | null;
  /** 0085: horário que se repete: a posição dele na série ("Repete: 3 de 8"), contando os dias da série; null = avulso. */ series?: { index: number; total: number } | null;
  /** 0089: as auxiliares do horário, na ordem (ocupam a coluna delas na grade com o selo "auxiliar de <principal>"). */ assistants?: { id: string; name: string }[];
};

const service = alias(lists, "service");

/** Os dias (Salvador) de cada série, em ordem: a posição do horário na série é o dia dele nessa lista. */
async function seriesDaysOf(seriesIds: string[]): Promise<Map<string, string[]>> {
  if (!seriesIds.length) return new Map();
  const day = sql<string>`to_char(${appointments.startsAt} at time zone 'America/Bahia', 'YYYY-MM-DD')`;
  const rows = await db.selectDistinct({ seriesId: appointments.seriesId, day }).from(appointments)
    .where(and(inArray(appointments.seriesId, seriesIds), isNull(appointments.avecTwinOf))).orderBy(day);
  const out = new Map<string, string[]>();
  for (const r of rows) if (r.seriesId) out.set(r.seriesId, [...(out.get(r.seriesId) ?? []), r.day]);
  return out;
}

/** O primeiro dia (Salvador) em que cada cliente foi atendida: visita finalizada (CRM ou Avec) ou comanda do Avec. */
async function firstVisitDays(contactIds: string[]): Promise<Map<string, string>> {
  if (!contactIds.length) return new Map();
  const [aps, sales] = await Promise.all([
    db.select({ id: appointments.contactId, day: sql<string>`to_char(min(${appointments.startsAt}) at time zone 'America/Bahia', 'YYYY-MM-DD')` }).from(appointments)
      .where(and(inArray(appointments.contactId, contactIds), eq(appointments.status, "compareceu"), isNull(appointments.avecTwinOf))).groupBy(appointments.contactId),
    db.select({ id: salesItems.contactId, day: sql<string>`min(${salesItems.soldOn})::text` }).from(salesItems).where(inArray(salesItems.contactId, contactIds)).groupBy(salesItems.contactId),
  ]);
  const out = new Map<string, string>();
  for (const r of [...aps, ...sales]) if (r.id && r.day && (!out.has(r.id) || r.day < out.get(r.id)!)) out.set(r.id, r.day);
  return out;
}

/**
 * A Agenda: os horários do período (um dia ou uma semana, em Salvador), em ordem. A agenda é da Casa: todo mundo que atende vê todos os
 * horários. Lead arquivado e contato ignorado ficam de fora; gêmeos do Avec e lista de espera também; cancelados entram.
 * Lote 6B: o horário ligado a um lead aparece **como horário** (e o lead some), porque é nele que a recepção marca Chegou, Finalizar e Faltou.
 */
export async function getAgenda(range: AgendaRange, now: Date = new Date(), opts: { professionalId?: string | null } = {}): Promise<AgendaItem[]> {
  const to = new Date(range.from.getTime() + range.days * 86_400_000);
  const [rows, aps] = await Promise.all([
    db.select({
      dealId: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`,
      alertNotes: contacts.alertNotes, imageUse: contacts.imageUse,
      scheduledAt: deals.scheduledAt, attendance: deals.attendance, serviceId: deals.serviceId, service: service.label, serviceDuration: service.durationMin, ownerName: teamNameCol(),
      professionalId: deals.professionalId, professionalName: professionals.name, professionalColor: professionals.color, professionalPhotoPath: professionals.photoPath, stageName: stages.name, stageKind: stages.kind,
    })
      .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
      .leftJoin(users, eq(users.id, deals.ownerId)).leftJoin(service, eq(service.id, deals.serviceId)).leftJoin(professionals, eq(professionals.id, deals.professionalId))
      .where(and(isNull(deals.archivedAt), eq(contacts.ignored, false), gte(deals.scheduledAt, range.from), lt(deals.scheduledAt, to),
        opts.professionalId ? eq(deals.professionalId, opts.professionalId) : undefined))
      .orderBy(asc(deals.scheduledAt)),
    listAppointments({ from: range.from, to }, { professionalId: opts.professionalId }),
  ]);

  const apptDeals = new Set(aps.map((a) => a.dealId).filter(Boolean));
  const apptSlots = new Set(aps.filter((a) => a.contactId).map((a) => `${a.contactId}|${a.startsAt.slice(0, 16)}`));
  const leadRows = rows.filter((r) => !apptDeals.has(r.dealId) && !apptSlots.has(`${r.contactId}|${new Date(r.scheduledAt!).toISOString().slice(0, 16)}`));

  const serviceIds = [...new Set(aps.map((a) => a.serviceId).filter((x): x is string => !!x))];
  const apContacts = [...new Set(aps.map((a) => a.contactId).filter((x): x is string => !!x))];
  const seriesIds = [...new Set(aps.map((a) => a.seriesId).filter((x): x is string => !!x))];
  const [durations, avatars, firstDay, typeLabels, funcoes, seriesDays, auxMap] = await Promise.all([
    serviceIds.length ? db.select({ id: lists.id, durationMin: lists.durationMin }).from(lists).where(inArray(lists.id, serviceIds)) : [],
    apContacts.length ? db.select({ id: contacts.id, ignored: contacts.ignored, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`, alertNotes: contacts.alertNotes, imageUse: contacts.imageUse }).from(contacts).where(inArray(contacts.id, apContacts)) : [],
    firstVisitDays([...new Set([...leadRows.map((r) => r.contactId), ...apContacts])]),
    getVisitTypes().then(visitTypeLabelMap),
    getFuncoes(),
    seriesDaysOf(seriesIds),
    auxiliariesOf(aps.map((a) => a.id)),
  ]);
  const seriesOf = (seriesId: string | null | undefined, at: string) => {
    const days = seriesId ? seriesDays.get(seriesId) : undefined;
    const index = days ? days.indexOf(dayOf(at)) + 1 : 0;
    return days && index ? { index, total: days.length } : null;
  };
  const imageUseOf = (u: ImageUse | null | undefined) => (funcoes.uso_imagem ? u ?? null : null);
  const durationOf = new Map(durations.map((d) => [d.id, d.durationMin]));
  const contactOf = new Map(avatars.map((c) => [c.id, c]));
  const isFirst = (contactId: string | null, at: string) => !!contactId && (!firstDay.has(contactId) || firstDay.get(contactId)! >= dayOf(at));

  const leads: AgendaItem[] = leadRows.map((r) => {
    const scheduledAt = new Date(r.scheduledAt!).toISOString();
    const d = entryDuration(null, r.serviceDuration);
    return {
      key: `lead:${r.dealId}`, source: "lead", dealId: r.dealId, appointmentId: null, visitId: null,
      contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: r.hasAvatar,
      scheduledAt, durationMin: d.minutes, durationEstimated: d.estimated, noTime: false,
      service: r.service, serviceId: r.serviceId, ownerName: r.ownerName, professionalId: r.professionalId, professionalName: r.professionalName ? displayName(r.professionalName) : null, professionalColor: r.professionalColor,
      professionalPhotoUrl: r.professionalId ? proPhotoUrl(r.professionalId, photoVersionOf(r.professionalPhotoPath)) : null, preference: null, stageName: r.stageName,
      status: agendaStatus({ scheduledAt, attendance: r.attendance, stageKind: r.stageKind }, now), dbStatus: null, origin: "crm", notes: null, bookedBy: null,
      paid: false, firstVisit: isFirst(r.contactId, scheduledAt), anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null,
      genericClient: false, alertNotes: r.alertNotes ?? null, imageUse: imageUseOf(r.imageUse),
    };
  });

  const booked: AgendaItem[] = aps.filter((a) => !(a.contactId && contactOf.get(a.contactId)?.ignored)).map((a) => {
    const d = entryDuration(a.durationMin, a.serviceId ? durationOf.get(a.serviceId) : null);
    return {
      key: `ag:${a.id}`, source: "agendamento", dealId: a.dealId, appointmentId: a.id, visitId: a.visitId,
      contactId: a.contactId, name: a.clientName, phone: a.phone, hasAvatar: !!(a.contactId && contactOf.get(a.contactId)?.hasAvatar),
      scheduledAt: a.startsAt, durationMin: d.minutes, durationEstimated: d.estimated,
      noTime: a.origin === "avec" && a.status === "cancelado" && minuteOfDay(a.startsAt) === 0,
      service: a.serviceLabel, serviceId: a.serviceId, ownerName: null, professionalId: a.professionalId, professionalName: a.professionalName ? displayName(a.professionalName) : null, professionalColor: a.professionalColor,
      professionalPhotoUrl: a.professionalId ? proPhotoUrl(a.professionalId, photoVersionOf(a.professionalPhotoPath)) : null,
      preference: (a.preference as Preference | null) ?? null, stageName: null,
      status: appointmentAgendaStatus(a, now), dbStatus: a.status, origin: a.origin === "crm" ? "crm" : "avec", notes: a.notes, bookedBy: a.bookedByName ?? a.createdByName,
      paid: false, firstVisit: isFirst(a.contactId, a.startsAt), anyPro: a.anyPro, fitIn: a.fitIn, outsideHours: a.outsideHours, confirmedVia: a.confirmedVia, cancelReason: a.cancelReason,
      genericClient: isGenericClientName(a.clientName), avecSemBaixa: !!a.avecSemBaixa,
      alertNotes: a.contactId ? contactOf.get(a.contactId)?.alertNotes ?? null : null, imageUse: imageUseOf(a.contactId ? contactOf.get(a.contactId)?.imageUse : null),
      label: a.label ?? null, visitType: (a.visitType as VisitType | null) ?? null, visitTypeLabel: a.visitType ? typeLabels[a.visitType as VisitType] ?? null : null,
      series: seriesOf(a.seriesId, a.startsAt),
      ...(auxMap.has(a.id) ? { assistants: auxMap.get(a.id)!.map((x) => ({ id: x.id, name: displayName(x.name) })) } : {}),
    };
  });

  // 6C: selo R$ (comanda fechada) e "falta fechar" (comanda aberta) de cada horário.
  const apptIds = booked.filter((i) => i.appointmentId).map((i) => i.appointmentId!);
  const links = apptIds.length ? await db.select({ appointmentId: comandaItems.appointmentId, comandaId: comandas.id, status: comandas.status })
    .from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(inArray(comandaItems.appointmentId, apptIds), isNull(comandaItems.cancelledAt), inArray(comandas.status, ["aberta", "fechada"]))) : [];
  for (const i of booked) {
    const l = links.filter((x) => x.appointmentId === i.appointmentId);
    i.paid = l.some((x) => x.status === "fechada");
    i.openComandaId = l.find((x) => x.status === "aberta")?.comandaId ?? null;
  }

  return [...leads, ...booked].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || (a.source === b.source ? 0 : a.source === "lead" ? -1 : 1));
}

export type BookableService = { id: string; label: string; durationMin: number | null; category: string | null };
/** Os serviços que dá para marcar (ativos), na ordem da lista. */
export async function listBookableServices(): Promise<BookableService[]> {
  return db.select({ id: lists.id, label: lists.label, durationMin: lists.durationMin, category: lists.category }).from(lists)
    .where(and(eq(lists.kind, "service"), eq(lists.active, true))).orderBy(asc(lists.position), asc(lists.label));
}

/** Preço de cada serviço (centavos), para o "Valor" do cartão na Agenda. Só para quem vê valores (quem chama confere valores.ver). */
export async function listServicePrices(): Promise<Record<string, number>> {
  const rows = await db.select({ id: lists.id, priceCents: lists.priceCents }).from(lists).where(eq(lists.kind, "service"));
  return Object.fromEntries(rows.filter((r) => r.priceCents != null).map((r) => [r.id, r.priceCents!]));
}

/**
 * Marcar (20/10): o preço e o tempo próprios de cada profissional por serviço (0084), para a folha mostrar a duração e o preço de quem
 * atende. Vazio com a função "Preço e tempo por profissional" desligada; preço só para quem vê valores (`withValues`).
 */
export async function listBookingTerms(withValues: boolean): Promise<Record<string, Record<string, { durationMin: number | null; priceCents: number | null }>>> {
  if (!(await getFuncoes()).preco_por_profissional) return {};
  const rows = await db.select({ pro: professionalServices.professionalId, svc: professionalServices.serviceId, d: professionalServices.durationMin, p: professionalServices.priceCents })
    .from(professionalServices).where(sql`${professionalServices.durationMin} is not null or ${professionalServices.priceCents} is not null`);
  const out: Record<string, Record<string, { durationMin: number | null; priceCents: number | null }>> = {};
  for (const r of rows) {
    const price = withValues ? r.p : null;
    if (r.d == null && price == null) continue;
    (out[r.pro] ??= {})[r.svc] = { durationMin: r.d, priceCents: price };
  }
  return out;
}
