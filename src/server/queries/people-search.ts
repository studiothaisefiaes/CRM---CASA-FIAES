import { sql } from "drizzle-orm";
import { db } from "../db";
import { phoneSearchVariants } from "@/lib/phone-search";
import { cpfSearchDigits } from "@/lib/cpf";

/**
 * `holderId`: a pessoa usa o número de outra (mãe e filha no mesmo celular, 0051): `phone` é o do titular, a conversa é a dele.
 * `holderName` e `relation` dizem de quem é o número ("filha").
 */
export type PersonFound = { contactId: string; name: string; phone: string; hasOpen: boolean; holderId?: string | null; holderName?: string | null; relation?: string | null };

/**
 * Busca da Fila que também acha quem NÃO aparece na lista (20/10: "pesquiso o telefone e não aparece"): cliente ou equipe com conversa resolvida,
 * antiga ou que nunca conversou, pelo nome, telefone ou CPF. Nunca número oculto. Até 6.
 * Mãe e filha no mesmo número (21/10, Cati: "só uma aparece"): a pessoa a mais aparece também, com o telefone e a conversa do titular.
 */
export async function searchPeople(q: string): Promise<PersonFound[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 3) return [];
  const vs = phoneSearchVariants(q);
  const cpf = cpfSearchDigits(q);
  const phone = sql`coalesce(h.phone_e164, c.phone_e164)`;
  const r = await db.execute(sql`
    select c.id as "contactId", c.name, ${phone} as phone, h.id as "holderId", h.name as "holderName", c.phone_relation as relation,
      exists (select 1 from deals d where d.contact_id = coalesce(h.id, c.id) and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null) as "hasOpen"
    from contacts c left join contacts h on h.id = c.shares_phone_with
    where c.kind in ('cliente', 'equipe') and ${phone} like '+%'
      and (lower(coalesce(c.name, '')) like ${"%" + term + "%"}
        ${sql.join(vs.map((v) => sql` or ${phone} like ${"%" + v + "%"}`), sql``)}
        ${cpf ? sql` or c.cpf like ${"%" + cpf + "%"}` : sql``})
    order by c.name limit 6`);
  type Row = { contactId: string; name: string | null; phone: string; holderId: string | null; holderName: string | null; relation: string | null; hasOpen: boolean };
  return (r.rows as Row[]).map((x) => ({ contactId: x.contactId, name: x.name?.trim() || x.phone, phone: x.phone, hasOpen: !!x.hasOpen,
    holderId: x.holderId, holderName: x.holderName, relation: x.relation }));
}
