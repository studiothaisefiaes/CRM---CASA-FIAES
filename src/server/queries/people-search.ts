import { and, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";
import { phoneSearchVariants } from "@/lib/phone-search";
import { cpfSearchDigits } from "@/lib/cpf";

export type PersonFound = { contactId: string; name: string; phone: string; hasOpen: boolean };

/**
 * Busca da Fila que também acha quem NÃO aparece na lista (20/10: "pesquiso o telefone e não aparece"): cliente ou equipe com conversa resolvida,
 * antiga ou que nunca conversou, pelo nome, telefone ou CPF. Nunca número oculto nem "pessoa a mais". Até 6.
 */
export async function searchPeople(q: string): Promise<PersonFound[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 3) return [];
  const vs = phoneSearchVariants(q);
  const cpf = cpfSearchDigits(q);
  const rows = await db.select({
    contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164,
    hasOpen: sql<boolean>`exists (select 1 from deals d where d.contact_id = ${contacts.id} and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null)`,
  }).from(contacts)
    .where(and(inArray(contacts.kind, ["cliente", "equipe"]), sql`${contacts.phoneE164} like '+%'`,
      or(sql`lower(coalesce(${contacts.name}, '')) like ${"%" + term + "%"}`, ...vs.map((v) => sql`${contacts.phoneE164} like ${"%" + v + "%"}`), ...(cpf ? [sql`${contacts.cpf} like ${"%" + cpf + "%"}`] : []))!))
    .orderBy(contacts.name).limit(6);
  return rows.map((r) => ({ contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasOpen: !!r.hasOpen }));
}
