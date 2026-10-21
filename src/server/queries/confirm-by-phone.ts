import { sql } from "drizzle-orm";
import { db } from "../db";
import { dayOf, instantOf, shiftDay, todayBahia } from "@/lib/agenda";
import { displayName } from "@/lib/display-name";
import { GENERIC_NAME_RE } from "@/lib/generic-client";

export type ConfirmByPhoneItem = { contactId: string; name: string; phone: string; firstStart: string; services: { service: string; pro: string | null }[] };

/**
 * Pendências › "Confirmar por telefone" (17/10): 35% das clientes da semana não têm conversa no CRM e por isso não recebem o lembrete
 * (a mesma regra do `reminder.ts`: sem lead não arquivado do titular do número, não envia). Lista quem tem horário AMANHÃ ainda não
 * confirmado (confirmou: sai da lista e do sino), com telefone e sem conversa, para a recepção ligar ou iniciar a conversa. Uma linha por cliente, na ordem da hora.
 * Fora: Equipe, Fornecedor e Spam, a CLIENTE PADRÃO, gêmeo do Avec. Pessoa a mais num número vale pelo titular (telefone e conversa).
 */
export async function listConfirmByPhone(now: Date): Promise<ConfirmByPhoneItem[]> {
  const tomorrow = shiftDay(todayBahia(now), 1);
  const rows = (await db.execute(sql`
    select a.contact_id as "contactId", c.name, a.starts_at as "startsAt", a.service_label as service, coalesce(boss.name, p.name) as pro,
      case when c.phone_e164 like '+%' then c.phone_e164 when h.phone_e164 like '+%' then h.phone_e164 else coalesce(c.phone_alt, h.phone_alt) end as phone
    from appointments a
    join contacts c on c.id = a.contact_id
    left join contacts h on h.id = c.shares_phone_with
    left join professionals p on p.id = a.professional_id
    left join professionals boss on boss.id = p.assistant_of
    where a.status = 'agendado' and a.avec_twin_of is null
      and a.starts_at >= ${instantOf(tomorrow, 0).toISOString()}::timestamptz and a.starts_at < ${instantOf(tomorrow, 1440).toISOString()}::timestamptz
      and c.kind = 'cliente' and coalesce(c.name, '') !~* ${GENERIC_NAME_RE}
      and not exists (select 1 from deals d where d.contact_id = coalesce(c.shares_phone_with, c.id) and d.archived_at is null)
    order by a.starts_at, coalesce(boss.name, p.name), a.service_label`)).rows as { contactId: string; name: string | null; startsAt: string | Date; service: string; pro: string | null; phone: string | null }[];
  const out = new Map<string, ConfirmByPhoneItem>();
  for (const r of rows) {
    if (!r.phone) continue;
    const start = new Date(r.startsAt);
    if (dayOf(start) !== tomorrow) continue;
    const it = out.get(r.contactId) ?? { contactId: r.contactId, name: displayName(r.name?.trim() || "Cliente"), phone: r.phone, firstStart: start.toISOString(), services: [] };
    const service = !r.service?.trim() || r.service.trim() === "Não informado" ? "Atendimento" : r.service;
    it.services.push({ service, pro: r.pro ? displayName(r.pro) : null });
    out.set(r.contactId, it);
  }
  return [...out.values()];
}
