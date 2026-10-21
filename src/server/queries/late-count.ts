import { and, eq, isNotNull, isNull, notLike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { db } from "../db";
import { alerts, contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";

type Who = Pick<SessionUser, "id" | "perms">;
/** `onlyOwn`: a atendente conta só os leads no nome dela (o resumo do dia e os links dos relatórios falam de "os seus"). */
type Scope = { onlyOwn?: boolean };

/**
 * "Atrasado" é do lead, não de quem olha: alerta de espera aberto (wait_key que não é de tarefa), um por lead
 * (nível 1 e 2 da mesma espera contam uma vez), sem lead arquivado nem contato ignorado.
 * Gestão conta todos; atendente conta os leads dela e os sem dono (o escopo da Fila), ou só os dela com `onlyOwn`.
 * O sino, o título da aba, o LateWatch e a Fila usam esta mesma condição.
 */
const lateWhere = (user: Who, scope: Scope = {}) => and(
  isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%"), isNull(alerts.resolvedAt),
  isNull(deals.archivedAt), eq(contacts.kind, "cliente"),
  can(user.perms, "atendimento.todas") ? undefined : scope.onlyOwn ? eq(deals.ownerId, user.id) : or(eq(deals.ownerId, user.id), isNull(deals.ownerId)),
);

/** O mesmo "atrasado" em SQL, para contar e filtrar sem trazer os ids: alerta de espera aberto (que não é de tarefa) do lead. */
export const lateExists = (dealId: SQL | AnyColumn): SQL =>
  sql`exists (select 1 from alerts al where al.deal_id = ${dealId} and al.wait_key is not null and al.wait_key not like 'task:%' and al.resolved_at is null)`;

/** Quantos leads estão com a espera vencida. */
export async function countLateLeads(user: Who, scope: Scope = {}): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${alerts.dealId})::int` }).from(alerts)
    .innerJoin(deals, eq(deals.id, alerts.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(lateWhere(user, scope));
  return row?.n ?? 0;
}

/** Os leads contados por `countLateLeads` (a Fila monta a seção "Atrasados" com eles, então os dois números batem). */
export async function lateDealIds(user: Who, scope: Scope = {}): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: alerts.dealId }).from(alerts)
    .innerJoin(deals, eq(deals.id, alerts.dealId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(lateWhere(user, scope));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}
