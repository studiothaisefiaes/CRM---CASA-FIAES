import { and, eq, isNotNull, isNull, notLike, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";

/**
 * Quantos leads estão com a espera vencida: alertas de espera abertos (wait_key que não é de tarefa), um por lead
 * (nível 1 e 2 da mesma espera contam uma vez), sem lead arquivado nem contato ignorado.
 * Atendente conta os leads dela; gestão conta todos.
 */
export async function countLateLeads(user: Pick<SessionUser, "id" | "role">): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${alerts.dealId})::int` }).from(alerts)
    .innerJoin(deals, eq(deals.id, alerts.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(
      isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%"), isNull(alerts.resolvedAt),
      isNull(deals.archivedAt), eq(contacts.ignored, false),
      user.role === "gestor" ? undefined : eq(deals.ownerId, user.id),
    ));
  return row?.n ?? 0;
}
