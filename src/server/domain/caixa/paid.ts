import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, clientCreditEntries, clientPackages, comandaItems, comandas, contacts, salesPayments } from "../../db/schema";
import { dayOf, shiftDay, todayBahia } from "@/lib/agenda";

/**
 * Agenda › "Já pagaram" (7.9): quem já pagou e ainda não fez o serviço. Uma linha por cliente, com o que falta usar (pacote com
 * sessão e dentro da validade; crédito com saldo no CRM; serviço pago antes do horário; crédito no Avec sem extrato, só para conferir),
 * o próximo horário e o vencimento mais perto. Nunca inventa saldo.
 */
export type PaidKind = "pacote" | "credito" | "servico_pago" | "credito_avec";
export type PaidEntry = { kind: PaidKind; label: string; valueCents: number | null; paidOn: string | null; validUntil: string | null };
export type PaidRow = { contactId: string; name: string; phone: string | null; entries: PaidEntry[]; nextAppointmentAt: string | null; soonestExpiry: string | null };
export type PaidFilter = { semHorario?: boolean; venceEm30?: boolean; tipo?: "pacote" | "credito" | null; withValues?: boolean };

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dm = (day: string) => DM.format(new Date(`${day}T12:00:00Z`));
const DMH = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const ORDER: PaidKind[] = ["pacote", "credito", "servico_pago", "credito_avec"];

async function collect(now: Date): Promise<Map<string, PaidEntry[]>> {
  const today = todayBahia(now);
  const out = new Map<string, PaidEntry[]>();
  const push = (id: string, e: PaidEntry) => out.set(id, [...(out.get(id) ?? []), e]);

  const pkgs = await db.select().from(clientPackages).where(and(isNotNull(clientPackages.contactId), isNull(clientPackages.cancelledAt),
    sql`${clientPackages.totalSessions} > ${clientPackages.usedSessions}`, sql`(${clientPackages.validUntil} is null or ${clientPackages.validUntil} >= ${today})`))
    .orderBy(sql`${clientPackages.validUntil} asc nulls last`, asc(clientPackages.packageName));
  for (const p of pkgs) push(p.contactId!, {
    kind: "pacote", label: `${p.packageName} · faltam ${p.totalSessions - p.usedSessions} de ${p.totalSessions}${p.validUntil ? ` · vence ${dm(p.validUntil)}` : ""}`,
    valueCents: p.priceCents, paidOn: p.purchasedOn, validUntil: p.validUntil,
  });

  const credits = await db.select({ id: clientCreditEntries.contactId, balance: sql<number>`sum(${clientCreditEntries.deltaCents})::int`, last: sql<string>`to_char(max(${clientCreditEntries.createdAt}) at time zone 'America/Bahia', 'YYYY-MM-DD')` })
    .from(clientCreditEntries).groupBy(clientCreditEntries.contactId).having(sql`sum(${clientCreditEntries.deltaCents}) > 0`);
  for (const c of credits) push(c.id, { kind: "credito", label: "Crédito da cliente", valueCents: c.balance, paidOn: c.last, validUntil: null });

  const prepaid = await db.select({ contactId: appointments.contactId, label: appointments.serviceLabel, startsAt: appointments.startsAt, total: comandaItems.totalCents, day: comandas.day })
    .from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId)).innerJoin(appointments, eq(appointments.id, comandaItems.appointmentId))
    .where(and(eq(comandas.status, "fechada"), isNull(comandaItems.cancelledAt), gt(appointments.startsAt, now), inArray(appointments.status, ["agendado", "confirmado"]), isNotNull(appointments.contactId)))
    .orderBy(asc(appointments.startsAt));
  for (const a of prepaid) push(a.contactId!, { kind: "servico_pago", label: `${a.label} pago antes do horário (${DMH.format(a.startsAt).replace(",", "")})`, valueCents: a.total, paidOn: a.day, validUntil: null });

  const avec = await db.selectDistinct({ id: salesPayments.contactId }).from(salesPayments)
    .where(and(isNotNull(salesPayments.contactId), sql`translate(lower(${salesPayments.method}), 'áéíóúâêôãõç', 'aeiouaeoaoc') like '%credito cliente%'`));
  for (const a of avec) if (!(out.get(a.id!) ?? []).some((e) => e.kind === "credito")) push(a.id!, { kind: "credito_avec", label: "Crédito no Avec (conferir)", valueCents: null, paidOn: null, validUntil: null });
  return out;
}

export async function listPaidNotUsed(f: PaidFilter, now = new Date()): Promise<PaidRow[]> {
  const byContact = await collect(now);
  const ids = [...byContact.keys()];
  if (!ids.length) return [];
  const people = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(inArray(contacts.id, ids));
  const next = await db.select({ id: appointments.contactId, at: sql<Date>`min(${appointments.startsAt})` }).from(appointments)
    .where(and(inArray(appointments.contactId, ids), gte(appointments.startsAt, now), inArray(appointments.status, ["agendado", "confirmado", "solicitado"]), isNull(appointments.avecTwinOf)))
    .groupBy(appointments.contactId);
  const limit = shiftDay(dayOf(now), 30);
  let rows: PaidRow[] = people.map((p) => {
    const entries = [...byContact.get(p.id)!].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).map((e) => (f.withValues ? e : { ...e, valueCents: null }));
    const expiries = entries.map((e) => e.validUntil).filter((d): d is string => !!d).sort();
    const at = next.find((n) => n.id === p.id)?.at;
    return { contactId: p.id, name: p.name?.trim() || "Cliente", phone: p.phone, entries, nextAppointmentAt: at ? new Date(at).toISOString() : null, soonestExpiry: expiries[0] ?? null };
  });
  if (f.semHorario) rows = rows.filter((r) => !r.nextAppointmentAt);
  if (f.venceEm30) rows = rows.filter((r) => r.soonestExpiry && r.soonestExpiry <= limit);
  if (f.tipo === "pacote") rows = rows.filter((r) => r.entries.some((e) => e.kind === "pacote"));
  if (f.tipo === "credito") rows = rows.filter((r) => r.entries.some((e) => e.kind === "credito" || e.kind === "credito_avec"));
  return rows.sort((a, b) => (a.soonestExpiry ?? "9999").localeCompare(b.soonestExpiry ?? "9999") || a.name.localeCompare(b.name, "pt-BR"));
}

/** A contagem no título da aba. */
export async function countPaidNotUsed(now = new Date()): Promise<number> {
  return (await collect(now)).size;
}
