import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { db } from "../db";
import { auditLog, contacts, deals, stages, users } from "../db/schema";
import { archiveDeals, restoreDeals } from "./archive";
import { moveDeal } from "./deals";
import { UserFacingError } from "./errors";
import { updateDealTx } from "./updates";
import { emit } from "./events";
import { BULK_MAX } from "../../lib/bulk-limits";
export { BULK_MAX };

/** Etapas que a ação em massa pode usar: as que não pedem diálogo (Agendado, Fechado e Perdido pedem dados). */
export const BULK_STAGE_KINDS = ["lead", "atendimento", "followup", "proposta", "retorno"] as const;

export type BulkWho = { id: string; perms: readonly string[] };
const seesAll = (u: BulkWho) => can(u.perms, "atendimento.todas");
export type BulkScope = "open" | "archived";

/**
 * Dos ids pedidos, os que `user` pode mexer: quem vê as conversas de todas mexe em todos; o resto, só nos seus e nos sem dono.
 * `open` = leads em andamento (não arquivados nem fechados); `archived` = os que estão em "não é cliente".
 * Sempre o servidor decide, mesmo que a tela só mostre os permitidos.
 */
export async function actionableIds(ids: string[], user: BulkWho, scope: BulkScope = "open"): Promise<string[]> {
  const unique = [...new Set(ids)].slice(0, BULK_MAX);
  if (!unique.length) return [];
  const conds: SQL[] = [inArray(deals.id, unique), scope === "open" ? and(isNull(deals.archivedAt), isNull(deals.closedAt))! : sql`${deals.archivedAt} is not null`];
  if (!seesAll(user)) conds.push(or(eq(deals.ownerId, user.id), isNull(deals.ownerId))!);
  const rows = await db.select({ id: deals.id }).from(deals).where(and(...conds));
  return rows.map((r) => r.id);
}

/**
 * "Não é cliente". `scoped` (padrão): em massa, a atendente só arquiva o que é dela ou não tem dono (o filtro vai no próprio UPDATE).
 * Individual (`scoped: false`): a action já conferiu o escopo antes (assertCanActOnDeal, M1 de 17/10), então aqui não filtra de novo.
 * `ids` devolve os que de fato saíram da fila: é o que o Desfazer restaura.
 */
export async function bulkArchive(ids: string[], user: BulkWho, opts: { scoped?: boolean } = {}): Promise<{ archived: number; ids: string[]; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const own = (opts.scoped ?? true) && !seesAll(user);
  const r = await archiveDeals(requested, user.id, own ? { onlyOwnerId: user.id } : {});
  return { archived: r.archived, ids: r.ids, skipped: requested.length - r.archived };
}

export async function bulkRestore(ids: string[], user: BulkWho, opts: { scoped?: boolean } = {}): Promise<{ restored: number; conflicts: string[]; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const own = (opts.scoped ?? true) && !seesAll(user);
  const r = await restoreDeals(requested, user.id, own ? { onlyOwnerId: user.id } : {});
  return { restored: r.restored, conflicts: r.conflicts, skipped: requested.length - r.restored - r.conflicts.length };
}

/** "Atribuir a…": quem pode transferir. Cada troca entra na auditoria como "Responsável: de → para". */
export async function bulkAssign(ids: string[], ownerId: string, user: BulkWho): Promise<{ assigned: number; skipped: number }> {
  if (!can(user.perms, "atendimento.transferir")) throw new UserFacingError("Você não tem permissão para atribuir conversas.");
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

/** "Resolver" em massa (o antigo Encerrar): cada conversa permitida e ainda não resolvida; volta sozinha se a cliente escrever. */
export async function bulkResolve(ids: string[], user: BulkWho): Promise<{ resolved: number; ids: string[]; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const allowed = await actionableIds(requested, user, "open");
  const open = (await db.select({ id: deals.id }).from(deals).where(and(inArray(deals.id, allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]), isNull(deals.conversationArchivedAt)))).map((r) => r.id);
  const { archiveConversation } = await import("./conversation-archive");
  const done: string[] = [];
  for (const id of open) { try { await archiveConversation(id, user.id); done.push(id); } catch { /* já mudou: fica de fora */ } }
  return { resolved: done.length, ids: done, skipped: requested.length - done.length };
}

/** "Mover etapa": só para etapas que não pedem diálogo. Cada lead anda numa transação própria; um que falha não derruba os outros. */
export async function bulkMove(ids: string[], stageKey: string, user: BulkWho): Promise<{ moved: number; skipped: number }> {
  const requested = [...new Set(ids)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const [stage] = await db.select({ key: stages.key, kind: stages.kind }).from(stages).where(and(eq(stages.key, stageKey), eq(stages.active, true)));
  if (!stage) throw new UserFacingError("Essa etapa não existe mais.");
  if (!(BULK_STAGE_KINDS as readonly string[]).includes(stage.kind)) throw new UserFacingError("Essa etapa pede dados. Abra a conversa para mudar.");
  const allowed = await actionableIds(requested, user, "open");
  let moved = 0;
  for (const id of allowed) {
    const [cur] = await db.select({ stageKey: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id));
    if (!cur || cur.stageKey === stage.key) continue;
    try { await moveDeal(id, stage.key, user.id, "manual"); moved++; } catch { /* o lead mudou no meio do caminho: segue com os outros */ }
  }
  return { moved, skipped: requested.length - moved };
}

const OPEN_DEAL_OF_CONTACT = sql`exists (select 1 from deals d join stages s on s.id = d.stage_id where d.contact_id = ${contacts.id} and d.archived_at is null and d.closed_at is null and s.kind not in ('fechado', 'perdido'))`;

/**
 * "Não é cliente" em massa pela lista de Contatos. Contato com lead aberto: o lead é arquivado (o mesmo caminho da Fila, que também marca o contato).
 * Contato sem lead aberto: é marcado direto. Escopo de dono como na Fila: a atendente só age no que é dela ou não tem dono (contato sem lead não tem dono);
 * a gestão age em tudo. Quem já estava marcado fica de fora. `dealIds` e `contactIds` são exatamente o que o Desfazer restaura.
 */
export async function bulkIgnoreContacts(contactIds: string[], user: BulkWho): Promise<{ ignored: number; skipped: number; dealIds: string[]; contactIds: string[] }> {
  const requested = [...new Set(contactIds)];
  if (requested.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  if (!requested.length) return { ignored: 0, skipped: 0, dealIds: [], contactIds: [] };
  const own = !seesAll(user);
  const rows = (await db.execute(sql`
    select c.id as "contactId", d.id as "dealId", d.owner_id as "ownerId"
    from contacts c
    left join lateral (select d2.id, d2.owner_id from deals d2 join stages s on s.id = d2.stage_id
      where d2.contact_id = c.id and d2.archived_at is null and d2.closed_at is null and s.kind not in ('fechado', 'perdido') order by d2.created_at desc limit 1) d on true
    where c.id in (${sql.join(requested.map((id) => sql`${id}::uuid`), sql`, `)}) and not c.ignored`)).rows as { contactId: string; dealId: string | null; ownerId: string | null }[];
  const withDeal = rows.filter((r) => r.dealId && (!own || !r.ownerId || r.ownerId === user.id));
  const withoutDeal = rows.filter((r) => !r.dealId).map((r) => r.contactId);

  const archived = withDeal.length ? await archiveDeals(withDeal.map((r) => r.dealId!), user.id, own ? { onlyOwnerId: user.id } : {}) : { archived: 0, ids: [] as string[] };
  const direct = withoutDeal.length
    ? await db.transaction(async (tx) => {
        const done = await tx.update(contacts).set({ ignored: true }).where(and(inArray(contacts.id, withoutDeal), eq(contacts.ignored, false), sql`not ${OPEN_DEAL_OF_CONTACT}`)).returning({ id: contacts.id });
        if (done.length) await tx.insert(auditLog).values(done.map((c) => ({ userId: user.id, action: "ignorou_contato", entity: "contact", entityId: c.id, data: {} })));
        return done.map((c) => c.id);
      })
    : [];
  const ignored = archived.archived + direct.length;
  return { ignored, skipped: requested.length - ignored, dealIds: archived.ids, contactIds: direct };
}

/** Desfazer de `bulkIgnoreContacts`: os leads voltam à etapa de antes (com a mesma regra de dono e de conflito da Fila) e os contatos marcados direto perdem a marca. */
export async function bulkUnignoreContacts(input: { dealIds: string[]; contactIds: string[] }, user: BulkWho): Promise<{ restored: number; conflicts: string[]; direct: number }> {
  const dealIds = [...new Set(input.dealIds)], contactIds = [...new Set(input.contactIds)];
  if (dealIds.length + contactIds.length > BULK_MAX) throw new UserFacingError(`Escolha no máximo ${BULK_MAX} de cada vez.`);
  const own = !seesAll(user);
  const r = dealIds.length ? await restoreDeals(dealIds, user.id, own ? { onlyOwnerId: user.id } : {}) : { restored: 0, conflicts: [] as string[] };
  const direct = contactIds.length
    ? await db.transaction(async (tx) => {
        const done = await tx.update(contacts).set({ ignored: false }).where(and(inArray(contacts.id, contactIds), eq(contacts.ignored, true))).returning({ id: contacts.id });
        if (done.length) await tx.insert(auditLog).values(done.map((c) => ({ userId: user.id, action: "voltou_a_acompanhar", entity: "contact", entityId: c.id, data: {} })));
        return done.length;
      })
    : 0;
  return { restored: r.restored, conflicts: r.conflicts, direct };
}
