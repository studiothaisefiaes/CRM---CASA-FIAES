import { sql } from "drizzle-orm";
import { WON_SQL } from "../reports/common";
import { db } from "../db";
import { getClientSnapshot } from "./client-snapshot";
import type { SituationState } from "../../lib/client-situation";
import type { ReturnInfo } from "../../lib/client-rhythm";

/**
 * O que a atendente precisa saber da cliente ao abrir a conversa. Desde o Lote 2 inclui o Avec (visitas, "desde", total)
 * e a mesma frase de situação da ficha. Valores só com `money`.
 */
export type ClientContext = {
  firstContactAt: string;
  isFirstContact: boolean;
  lastVisit: { at: string; service: string | null; by: string | null } | null;
  visits: number;
  lastSales: { at: string; service: string | null; valueCents: number | null }[];
  totalCents: number | null;
  previousOwner: string | null;
  /** `requested`: a cliente pediu essa profissional ("Pediu ela"). */
  nextAppointment: { /** O horário (17/10: a conversa abre a visita e cancela por ele). */ id?: string; startsAt: string; serviceLabel: string; professionalName: string | null; requested?: boolean } | null;
  /** Todos os horários da visita do próximo horário: várias profissionais ao mesmo tempo; a assistente aparece como assistente. */
  nextVisit?: { serviceLabel: string; professionalName: string | null; startsAt: string; assistant: boolean }[];
  activePackage: { packageName: string; usedSessions: number; totalSessions: number } | null;
  /** A frase de situação (a mesma da ficha), a versão curta e os estados. */
  situation: string; short: string; states: SituationState[];
  retorno: ReturnInfo | null;
  preferredProfessional: string | null;
  alertNotes: string | null;
  knownSince: string | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

export async function clientContext(contactId: string, dealId: string, opts: { money: boolean }): Promise<ClientContext> {
  const now = new Date();
  const [[base], visits, sales, [prev], snap] = await Promise.all([
    db.execute(sql`
      select least(c.created_at, coalesce((select min(m.created_at) from messages m where m.contact_id = c.id), c.created_at),
                   coalesce((select min(d.created_at) from deals d where d.contact_id = c.id), c.created_at)) as first,
             (select count(*)::int from deals d where d.contact_id = c.id and d.id <> ${dealId}) as others,
             c.client_since as "clientSince"
      from contacts c where c.id = ${contactId}`).then((r) => r.rows as { first: string; others: number; clientSince: string | null }[]),
    db.execute(sql`
      select coalesce(d.scheduled_at, d.attendance_at, d.closed_at) as at, l.label as service, u.name as by
      from deals d left join lists l on l.id = d.service_id left join users u on u.id = d.owner_id
      where d.contact_id = ${contactId} and d.attendance = 'compareceu'
      order by coalesce(d.scheduled_at, d.attendance_at, d.closed_at) desc`).then((r) => r.rows as { at: string; service: string | null; by: string | null }[]),
    db.execute(sql`
      select d.closed_at as at, l.label as service, d.value_cents as "valueCents"
      from deals d join stages s on s.id = d.stage_id left join lists l on l.id = d.service_id
      where d.contact_id = ${contactId} and ${sql.raw(WON_SQL)}
      order by d.closed_at desc`).then((r) => r.rows as { at: string; service: string | null; valueCents: number | null }[]),
    db.execute(sql`
      select u.name from deals d join users u on u.id = d.owner_id
      where d.contact_id = ${contactId} and d.id <> ${dealId} and d.closed_at is not null
      order by d.closed_at desc limit 1`).then((r) => r.rows as { name: string }[]),
    getClientSnapshot(contactId, { money: opts.money, now }),
  ]);
  const crm = visits[0];
  const avecLast = snap?.stats.lastVisitOn ? `${snap.stats.lastVisitOn}T15:00:00.000Z` : null;
  const lastVisit = crm && (!avecLast || Date.parse(iso(crm.at)) >= Date.parse(avecLast))
    ? { at: iso(crm.at), service: crm.service, by: crm.by }
    : avecLast ? { at: avecLast, service: null, by: null } : null;
  const visitCount = Math.max(visits.length, snap?.stats.visits ?? 0);
  const firstAt = Math.min(Date.parse(iso(base?.first ?? now)), snap?.knownSince ? Date.parse(snap.knownSince) : Infinity);
  const crmTotal = sales.reduce((n, s) => n + (s.valueCents ?? 0), 0);
  const avecTotal = snap?.stats.totalCents ?? 0;
  return {
    firstContactAt: new Date(firstAt).toISOString(),
    isFirstContact: (!base || base.others === 0) && visitCount === 0 && !base?.clientSince,
    lastVisit,
    visits: visitCount,
    lastSales: sales.slice(0, 3).map((s) => ({ at: iso(s.at), service: s.service, valueCents: opts.money ? s.valueCents : null })),
    // O Avec é o caixa da Casa: com venda lá, vale o total do Avec; venda só no CRM conta quando não há nada do Avec.
    totalCents: opts.money ? (avecTotal > 0 ? avecTotal : crmTotal) : null,
    previousOwner: prev?.name ?? null,
    nextAppointment: snap?.nextAppointment ? { id: snap.nextAppointment.id, startsAt: snap.nextAppointment.startsAt, serviceLabel: snap.nextAppointment.serviceLabel, professionalName: snap.nextAppointment.professionalName, requested: snap.nextAppointment.preference === "escolhida" } : null,
    nextVisit: snap?.nextVisit,
    activePackage: snap?.activePackage ?? null,
    situation: snap?.situation.sentence ?? "", short: snap?.situation.short ?? "", states: snap?.situation.states ?? [],
    retorno: snap?.situation.retorno ?? null,
    preferredProfessional: snap?.preferred?.name ?? null,
    alertNotes: snap?.alertNotes ?? null,
    knownSince: snap?.knownSince ?? null,
  };
}
