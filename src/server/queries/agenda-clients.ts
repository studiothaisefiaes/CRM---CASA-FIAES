import { and, eq, isNull, notInArray, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, professionals } from "../db/schema";
import { dayOf } from "@/lib/agenda";
import { isHiddenNumber } from "@/lib/phone-client";

/** `sharesWith`: pessoa a mais num número (0051): o nome do titular e a relação ("filha"), para a tela dizer de quem é o número. */
export type AgendaClientHit = { id: string; name: string; phone: string | null; lastVisit: string | null; ignored: boolean; sharesWith?: { name: string | null; relation: string | null } | null };
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Busca de cliente no Marcar e na Agenda: nome (começo do nome primeiro) ou telefone (4 dígitos ou mais), com a última visita (CRM ou Avec).
 * Quem está como "Não é cliente" aparece por último (marcar a traz de volta). Nunca devolve CPF nem e-mail.
 * Pessoa a mais num número (filha, mãe…, 0051) aparece também pelo telefone do titular, com o telefone dele.
 */
export async function searchAgendaClients(q: string, limit = 8): Promise<AgendaClientHit[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const byPhone = digits.length >= 4 ? sql`coalesce(h.phone_e164, c.phone_e164) like ${`%${digits}%`}` : sql`false`;
  // CPF (22/10, Caixa e Agenda): os 11 dígitos exatos; o CPF nunca volta na resposta.
  const byCpf = digits.length === 11 && /^[\d.\-\s]+$/.test(term) ? sql`c.cpf = ${digits}` : sql`false`;
  const r = await db.execute(sql`
    select c.id, c.name, coalesce(h.phone_e164, c.phone_e164) as phone, c.ignored, h.name as holder_name, c.phone_relation as relation, (h.id is not null) as shares,
      greatest(
        (select to_char(max(a.starts_at) at time zone 'America/Bahia', 'YYYY-MM-DD') from appointments a where a.contact_id = c.id and a.status = 'compareceu' and a.avec_twin_of is null),
        (select max(s.sold_on)::text from sales_items s where s.contact_id = c.id)
      ) as last_visit
    from contacts c left join contacts h on h.id = c.shares_phone_with
    where coalesce(c.name, '') ilike ${`%${escapeLike(term)}%`} or ${byPhone} or ${byCpf}
    order by c.ignored, (coalesce(c.name, '') ilike ${`${escapeLike(term)}%`}) desc, coalesce(h.name, c.name) nulls last, (h.id is not null), c.name nulls last
    limit ${limit}`);
  type Row = { id: string; name: string | null; phone: string; ignored: boolean; last_visit: string | null; holder_name: string | null; relation: string | null; shares: boolean };
  return (r.rows as Row[]).map((x) => ({
    id: x.id, name: x.name?.trim() || "Sem nome", phone: isHiddenNumber(x.phone) ? null : x.phone, lastVisit: x.last_visit, ignored: x.ignored,
    sharesWith: x.shares ? { name: x.holder_name, relation: x.relation } : null,
  }));
}

export type ClientAgendaEntry = { appointmentId: string; day: string; startsAt: string; serviceLabel: string; professionalName: string | null; status: string; origin: string };
export type ClientAgenda = { futuros: ClientAgendaEntry[]; passados: ClientAgendaEntry[]; cancelados: ClientAgendaEntry[] };

/** "Buscar cliente na Agenda": os horários dela (próximos, anteriores e cancelados), sem gêmeos nem pedidos da lista de espera. */
export async function clientAgenda(contactId: string, now = new Date(), limit = 30): Promise<ClientAgenda> {
  const rows = await db.select({ id: appointments.id, startsAt: appointments.startsAt, serviceLabel: appointments.serviceLabel, professionalName: professionals.name,
    status: appointments.status, origin: appointments.origin })
    .from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.contactId, contactId), isNull(appointments.avecTwinOf), notInArray(appointments.status, ["espera", "espera_encaixada", "espera_desistiu"])))
    .orderBy(desc(appointments.startsAt)).limit(limit * 3);
  const entry = (r: (typeof rows)[number]): ClientAgendaEntry => ({ appointmentId: r.id, day: dayOf(r.startsAt), startsAt: r.startsAt.toISOString(), serviceLabel: r.serviceLabel,
    professionalName: r.professionalName, status: r.status, origin: r.origin });
  return {
    futuros: rows.filter((r) => r.status !== "cancelado" && r.startsAt >= now).reverse().slice(0, limit).map(entry),
    passados: rows.filter((r) => r.status !== "cancelado" && r.startsAt < now).slice(0, limit).map(entry),
    cancelados: rows.filter((r) => r.status === "cancelado").slice(0, limit).map(entry),
  };
}
