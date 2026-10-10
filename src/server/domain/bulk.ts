import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { deals, stages, users } from "../db/schema";
import { archiveDeals, restoreDeals } from "./archive";
import { moveDeal } from "./deals";
import { UserFacingError } from "./errors";
import { updateDealTx } from "./updates";
import { emit } from "./events";
import { BULK_MAX } from "../../lib/bulk-limits";
export { BULK_MAX };

/** Etapas que a ação em massa pode usar: as que não pedem diálogo (Agendado, Fechado e Perdido pedem dados). */
export const BULK_STAGE_KINDS = ["lead", "atendimento", "followup"] as const;

export type BulkWho = { id: string; role: "gestor" | "atendente" };
export type BulkScope = "open" | "archived";

/**
 * Dos ids pedidos, os que `user` pode mexer: a gestão mexe em todos; a atendente só nos dela e nos sem dono.
 * `open` = leads em andamento (não arquivados nem fechados); `archived` = os que estão em "não é cliente".
 * Sempre o servidor decide, mesmo que a tela só mostre os permitidos.
 */
export async function actionableIds(ids: string[], user: BulkWho, scope: BulkScope = "open"): Promise<string[]> {
  const unique = [...new Set(ids)].slice(0, BULK_MAX);
  if (!unique.length) return [];
  const conds: SQL[] = [inArray(deals.id, unique), scope === "open" ? and(isNull(deals.archivedAt), isNull(deals.closedAt))! : sql`${deals.archivedAt} is not null`];
  if (user.role !== "gestor") conds.push(or(eq(deals.ownerId, user.id), isNull(deals.ownerId))!);
  const rows = await db.select({ id: deals.id }).from(deals).where(and(...conds));
  return rows.map((r) => r.id);
}

/**
 * "Não é cliente". `scoped` (padrão): em massa, a atendente só arquiva o que é dela ou não tem dono (o filtro vai no próprio UPDATE).
 * Individual (`scoped: false`) vale para qualquer lead: o salão é compartilhado e a atendente pode agir no lead de outra pessoa.
 * `ids` devolve os que de fato saíram da fila: é o que o Desfazer restaura.
 */
export async function bulkArchive(ids: string[], user: BulkWho, opts: { scoped?: boolean } = {}): Promise<{ archived: number; ids: string[]; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const own = (opts.scoped ?? true) && user.role !== "gestor";
  const r = await archiveDeals(requested, user.id, own ? { onlyOwnerId: user.id } : {});
  return { archived: r.archived, ids: r.ids, skipped: requested.length - r.archived };
}

export async function bulkRestore(ids: string[], user: BulkWho, opts: { scoped?: boolean } = {}): Promise<{ restored: number; conflicts: string[]; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const own = (opts.scoped ?? true) && user.role !== "gestor";
  const r = await restoreDeals(requested, user.id, own ? { onlyOwnerId: user.id } : {});
  return { restored: r.restored, conflicts: r.conflicts, skipped: requested.length - r.restored - r.conflicts.length };
}

/** "Atribuir a…": só a gestão. Cada troca entra na auditoria como "Responsável: de → para". */
export async function bulkAssign(ids: string[], ownerId: string, user: BulkWho): Promise<{ assigned: number; skipped: number }> {
  if (user.role !== "gestor") throw new UserFacingError("Só a gestão atribui leads.");
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.active, true)));
  if (!target) throw new UserFacingError("Essa pessoa não está mais na equipe.");
  const allowed = await actionableIds(requested, user, "open");
  const changed = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: deals.id }).from(deals).where(and(inArray(deals.id, allowed), or(isNull(deals.ownerId), sql`${deals.ownerId} <> ${ownerId}`)));
    for (const r of rows) await updateDealTx(tx, r.id, { ownerId }, user.id);
    return rows.map((r) => r.id);
  });
  for (const id of changed) await emit("lead_atualizado", { dealId: id });
  return { assigned: changed.length, skipped: requested.length - changed.length };
}

/** "Mover etapa": só para etapas que não pedem diálogo. Cada lead anda numa transação própria; um que falha não derruba os outros. */
export async function bulkMove(ids: string[], stageKey: string, user: BulkWho): Promise<{ moved: number; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const [stage] = await db.select({ key: stages.key, kind: stages.kind }).from(stages).where(and(eq(stages.key, stageKey), eq(stages.active, true)));
  if (!stage) throw new UserFacingError("Essa etapa não existe mais.");
  if (!(BULK_STAGE_KINDS as readonly string[]).includes(stage.kind)) throw new UserFacingError("Essa etapa pede dados. Abra o lead para mudar.");
  const allowed = await actionableIds(requested, user, "open");
  let moved = 0;
  for (const id of allowed) {
    const [cur] = await db.select({ stageKey: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id));
    if (!cur || cur.stageKey === stage.key) continue;
    try { await moveDeal(id, stage.key, user.id, "manual"); moved++; } catch { /* o lead mudou no meio do caminho: segue com os outros */ }
  }
  return { moved, skipped: requested.length - moved };
}
