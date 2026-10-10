import { and, eq, isNotNull, isNull, notLike, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";

type Who = Pick<SessionUser, "id" | "role">;

/**
 * "Atrasado" tem uma definição só: alerta de espera aberto (wait_key que não é de tarefa), um por lead
 * (nível 1 e 2 da mesma espera contam uma vez), sem lead arquivado nem contato ignorado.
 * Atendente conta os leads dela; gestão conta todos. O sino, o Hoje, o resumo e a Fila usam esta mesma condição.
 */
const lateWhere = (user: Who) => and(
  isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%"), isNull(alerts.resolvedAt),
  isNull(deals.archivedAt), eq(contacts.ignored, false),
  user.role === "gestor" ? undefined : eq(deals.ownerId, user.id),
);

/** Quantos leads estão com a espera vencida. */
export async function countLateLeads(user: Who): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${alerts.dealId})::int` }).from(alerts)
    .innerJoin(deals, eq(deals.id, alerts.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(lateWhere(user));
  return row?.n ?? 0;
}

/** Os leads contados por `countLateLeads` (a Fila monta a seção "Atrasados" com eles, então os dois números batem). */
export async function lateDealIds(user: Who): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: alerts.dealId }).from(alerts)
    .innerJoin(deals, eq(deals.id, alerts.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(lateWhere(user));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}
