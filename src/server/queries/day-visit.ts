import { genericClientSql } from "@/lib/generic-client";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { appointments, comandaItems, comandas, contacts, deals, lists, professionals } from "../db/schema";
import { dayOf, instantOf } from "@/lib/agenda";
import { displayName } from "@/lib/display-name";
import type { DayVisit, DayVisitService } from "@/lib/day-visit";

/**
 * A visita do dia de uma cliente (17/10: "uma comanda de tudo que a pessoa vai fazer hoje"): os horários da Agenda da mesma cliente
 * (ou do mesmo nome, sem ficha) no dia, com quem atende (a principal) e a assistente, início e fim, estado e valor; e a comanda do Caixa
 * da visita, quando existe (o valor do item dela manda). Fora: lista de espera e cancelamento do Avec sem hora (00:00), gêmeo do Avec,
 * a CLIENTE PADRÃO e o status `conferir` (o Avec disse algo que o CRM não conhece: a recepção resolve em "Conferir com o Avec").
 * Valores só para quem tem "valores.ver".
 */
const principal = alias(professionals, "principal");
// A mesma régua de quem entra no dia para o Hoje (`dayTableVisits`) e o Ao vivo (`buildLiveBoard`): fora a lista de espera, o cancelamento
// do Avec sem hora, o horário às 00:00 de Salvador (espera e "sem hora" do Avec), o status `conferir` e a CLIENTE PADRÃO.
const OUT = sql`(${appointments.status} like 'espera%' or (${appointments.status} = 'cancelado' and ${appointments.externalKey} like '%T--:--%')
  or to_char(${appointments.startsAt} at time zone 'America/Bahia', 'HH24:MI') = '00:00'
  or ${appointments.status} = 'conferir' or ${genericClientSql(appointments)})`;

type Row = {
  id: string; visitId: string | null; contactId: string | null; name: string | null; startsAt: Date; durationMin: number | null; status: string;
  service: string; serviceId: string | null; professionalId: string | null; pro: string | null; boss: string | null; priceCents: number | null;
  arrivedAt: Date | null; cancelledAt: Date | null;
};

async function rowsOf(where: ReturnType<typeof and>): Promise<Row[]> {
  return db.select({
    id: appointments.id, visitId: appointments.visitId, contactId: appointments.contactId,
    name: sql<string | null>`coalesce(${contacts.name}, ${appointments.clientName})`, startsAt: appointments.startsAt,
    durationMin: sql<number | null>`coalesce(${appointments.durationMin}, ${lists.durationMin})`, status: appointments.status,
    service: appointments.serviceLabel, serviceId: appointments.serviceId, professionalId: appointments.professionalId,
    pro: professionals.name, boss: principal.name, priceCents: sql<number | null>`coalesce(${appointments.priceCents}, ${lists.priceCents})`,
    arrivedAt: sql<Date | null>`least(${appointments.arrivedAt}, ${appointments.startedAt})`, // O cancelamento importado do Avec não grava cancelled_at: vale a hora em que a importação gravou (updated_at).
    cancelledAt: sql<Date | null>`coalesce(${appointments.cancelledAt}, case when ${appointments.status} = 'cancelado' and ${appointments.origin} = 'avec' then ${appointments.updatedAt} end)`,
  }).from(appointments)
    .leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(lists, eq(lists.id, appointments.serviceId))
    .leftJoin(professionals, eq(professionals.id, appointments.professionalId)).leftJoin(principal, eq(principal.id, professionals.assistantOf))
    .where(and(where, isNull(appointments.avecTwinOf), sql`not ${OUT}`))
    .orderBy(asc(appointments.startsAt), sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name), asc(appointments.serviceLabel), asc(appointments.id));
}

const keyOf = (r: { contactId: string | null; name: string | null; startsAt: Date }) => `${r.contactId ?? `nome:${r.name ?? ""}`}|${dayOf(r.startsAt)}`;

async function build(rows: Row[], withValues: boolean): Promise<DayVisit[]> {
  if (!rows.length) return [];
  const visitIds = [...new Set(rows.map((r) => r.visitId).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const [cmds, items, dealRows] = await Promise.all([
    visitIds.length ? db.select({ id: comandas.id, number: comandas.number, status: comandas.status, visitId: comandas.visitId }).from(comandas)
      .where(and(inArray(comandas.visitId, visitIds), inArray(comandas.status, ["aberta", "fechada"]))).orderBy(desc(comandas.openedAt)) : [],
    withValues ? db.select({ appointmentId: comandaItems.appointmentId, total: sql<number | null>`coalesce(${comandaItems.totalCents}, round(${comandaItems.unitCents} * ${comandaItems.qty})::int)` })
      .from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
      .where(and(inArray(comandaItems.appointmentId, rows.map((r) => r.id)), isNull(comandaItems.cancelledAt), inArray(comandas.status, ["aberta", "fechada"]))) : [],
    contactIds.length ? db.select({ id: deals.id, contactId: deals.contactId }).from(deals)
      .where(and(inArray(deals.contactId, contactIds), isNull(deals.archivedAt))).orderBy(sql`${deals.closedAt} is not null`, desc(deals.createdAt)) : [],
  ]);
  const itemPrice = new Map(items.filter((i) => i.appointmentId).map((i) => [i.appointmentId!, i.total]));
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const out: DayVisit[] = [];
  for (const [key, g] of groups) {
    const svc = (r: Row): DayVisitService => ({
      appointmentId: r.id, serviceId: r.serviceId, service: r.service?.trim() && r.service.trim() !== "Não informado" ? displayName(r.service.trim()) : "Atendimento",
      professionalId: r.professionalId, pro: r.boss ? displayName(r.boss) : r.pro ? displayName(r.pro) : null, assistant: r.boss && r.pro ? displayName(r.pro) : null,
      start: r.startsAt.toISOString(), end: r.durationMin != null ? new Date(r.startsAt.getTime() + r.durationMin * 60_000).toISOString() : null,
      status: r.status, priceCents: withValues ? (itemPrice.has(r.id) ? itemPrice.get(r.id)! : r.priceCents) : null,
      arrivedAt: r.arrivedAt ? new Date(r.arrivedAt).toISOString() : null, cancelledAt: r.cancelledAt ? new Date(r.cancelledAt).toISOString() : null,
    });
    const services = g.filter((r) => r.status !== "cancelado").map(svc);
    const cancelled = g.filter((r) => r.status === "cancelado").map(svc);
    const first = g[0];
    const visitId = g.find((r) => r.visitId)?.visitId ?? null;
    const cmd = visitId ? cmds.find((c) => c.visitId === visitId) : undefined;
    out.push({
      key, visitId, contactId: first.contactId, dealId: first.contactId ? dealRows.find((d) => d.contactId === first.contactId)?.id ?? null : null,
      name: displayName(first.name?.trim() || "Cliente"), day: dayOf(first.startsAt), entry: (services[0] ?? cancelled[0]).start,
      services, cancelled, comanda: cmd ? { id: cmd.id, number: cmd.number, status: cmd.status } : null, values: withValues,
    });
  }
  return out.sort((a, b) => a.entry.localeCompare(b.entry) || a.name.localeCompare(b.name, "pt-BR"));
}

/** A visita do dia do horário (qualquer serviço dela abre a mesma). null: horário não existe ou é de lista de espera. */
export async function dayVisitFor(appointmentId: string, opts: { withValues: boolean }): Promise<DayVisit | null> {
  const [a] = await db.select({ contactId: appointments.contactId, clientName: appointments.clientName, startsAt: appointments.startsAt })
    .from(appointments).where(and(eq(appointments.id, appointmentId), sql`not ${OUT}`));
  if (!a) return null;
  const day = dayOf(a.startsAt);
  const same = a.contactId ? eq(appointments.contactId, a.contactId) : and(isNull(appointments.contactId), eq(appointments.clientName, a.clientName ?? ""));
  const rows = await rowsOf(and(same, gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440))));
  return (await build(rows, opts.withValues))[0] ?? null;
}

/** As visitas de um dia (o quadro do Hoje), em ordem de entrada. */
export async function dayVisitsOf(day: string, opts: { withValues: boolean }): Promise<DayVisit[]> {
  const rows = await rowsOf(and(gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440))));
  return build(rows, opts.withValues);
}
