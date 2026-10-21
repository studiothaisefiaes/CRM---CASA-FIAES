import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals } from "../db/schema";
import { can } from "@/lib/permissions";
import { phoneSearchVariants } from "@/lib/phone-search";
import type { SessionUser } from "../auth/sessions-store";

/** `dealId` null: a pessoa não tem conversa aberta (resolvida, antiga ou nunca conversou); encaminhar abre uma (20/10). */
export type ForwardTarget = { dealId: string | null; contactId: string; name: string; phone: string; team: boolean };

/**
 * Para quem encaminhar: conversas abertas de cliente e de Equipe (fornecedor e spam ficam de fora), as de Equipe no topo.
 * Sem "Ver conversas de todas", só as dela e as sem dona (o mesmo escopo da Fila). Busca por nome ou telefone.
 */
export async function forwardTargets(user: Pick<SessionUser, "id" | "perms">, q: string, exceptDealId?: string | null): Promise<ForwardTarget[]> {
  const term = q.trim().toLowerCase();
  const conds = [isNull(deals.closedAt), isNull(deals.archivedAt), inArray(contacts.kind, ["cliente", "equipe"])];
  if (exceptDealId) conds.push(ne(deals.id, exceptDealId));
  if (!can(user.perms, "atendimento.todas")) conds.push(or(eq(deals.ownerId, user.id), isNull(deals.ownerId))!);
  if (term) {
    const vs = phoneSearchVariants(q);
    conds.push(or(sql`lower(coalesce(${contacts.name}, '')) like ${"%" + term + "%"}`, ...vs.map((v) => sql`${contacts.phoneE164} like ${"%" + v + "%"}`))!);
  }
  const rows = await db.select({ dealId: deals.id, contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, kind: contacts.kind }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(...conds))
    .orderBy(sql`(${contacts.kind} = 'equipe') desc`, desc(deals.lastInboundAt)).limit(20);
  const open: ForwardTarget[] = rows.map((r) => ({ dealId: r.dealId, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, team: r.kind === "equipe" }));
  if (!term) return open;
  // "Encaminhar para outras pessoas" (20/10): buscando, também quem não tem conversa aberta (resolvida, antiga ou nunca conversou), cliente ou
  // equipe, com número de WhatsApp de verdade (nunca número oculto nem "pessoa a mais"). Encaminhar abre a conversa.
  const vs = phoneSearchVariants(q);
  const seen = new Set(open.map((t) => t.contactId));
  const more = await db.select({ contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, kind: contacts.kind }).from(contacts)
    .where(and(inArray(contacts.kind, ["cliente", "equipe"]), sql`${contacts.phoneE164} like '+%'`,
      sql`not exists (select 1 from deals od where od.contact_id = ${contacts.id} and od.closed_at is null and od.archived_at is null)`,
      or(sql`lower(coalesce(${contacts.name}, '')) like ${"%" + term + "%"}`, ...vs.map((v) => sql`${contacts.phoneE164} like ${"%" + v + "%"}`))!))
    .orderBy(sql`(${contacts.kind} = 'equipe') desc`, contacts.name).limit(20);
  return [...open, ...more.filter((m) => !seen.has(m.contactId)).map((m) => ({ dealId: null, contactId: m.contactId, name: m.name?.trim() || m.phone, phone: m.phone, team: m.kind === "equipe" }))].slice(0, 30);
}
