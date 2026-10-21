import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, contacts, deals } from "../db/schema";
import { emit, logEvent } from "./events";
import { findOpenDeal } from "./deals";

/**
 * "Não é cliente" (individual ou em massa): o lead sai do funil, da fila, dos relatórios e do motor,
 * mas nada é apagado. Guarda a etapa em que estava para o Desfazer devolver tudo como era.
 */
/** `onlyOwnerId`: a atendente em massa só arquiva o que é dela ou não tem dono; o filtro vai no próprio UPDATE (mesma transação, sem janela entre conferir e gravar). */
export type OwnerScope = { onlyOwnerId?: string };
export async function archiveDeals(dealIds: string[], userId: string, scope: OwnerScope = {}): Promise<{ archived: number; ids: string[] }> {
  const ids = [...new Set(dealIds)];
  if (!ids.length) return { archived: 0, ids: [] };
  const done = await db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx.update(deals).set({ archivedAt: now, archivedBy: userId, archivedStageId: sql`${deals.stageId}` })
      .where(and(inArray(deals.id, ids), isNull(deals.archivedAt), scope.onlyOwnerId ? or(eq(deals.ownerId, scope.onlyOwnerId), isNull(deals.ownerId)) : undefined))
      .returning({ id: deals.id, contactId: deals.contactId, stageId: deals.stageId });
    if (!rows.length) return rows;
    // Só vira "não é cliente" o contato que não ficou com outro lead em andamento (ex.: arquivou um lead antigo já fechado).
    for (const contactId of new Set(rows.map((r) => r.contactId))) {
      if (!(await findOpenDeal(contactId, tx))) await tx.update(contacts).set({ ignored: true }).where(eq(contacts.id, contactId));
    }
    // Avisos pendentes do lead arquivado se resolvem (ninguém precisa responder "não é cliente").
    await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(inArray(alerts.dealId, rows.map((r) => r.id)), isNull(alerts.resolvedAt)));
    for (const r of rows) await logEvent(tx, r.id, "arquivado", { etapa: r.stageId }, userId);
    await tx.insert(auditLog).values(rows.map((r) => ({ userId, action: "arquivou_lead", entity: "deal", entityId: r.id, data: { contactId: r.contactId } })));
    return rows;
  });
  for (const r of done) await emit("lead_arquivado", { dealId: r.id });
  return { archived: done.length, ids: done.map((r) => r.id) };
}

/**
 * Desfazer o "não é cliente": volta para a etapa em que estava, com as mensagens que chegaram nesse meio-tempo.
 * Se o contato já tiver outro lead aberto, não restaura (nunca dois abertos) e devolve o id em `conflicts`.
 */
export async function restoreDeals(dealIds: string[], userId: string, scope: OwnerScope = {}): Promise<{ restored: number; conflicts: string[] }> {
  const ids = [...new Set(dealIds)];
  const restored: string[] = [];
  const conflicts: string[] = [];
  if (!ids.length) return { restored: 0, conflicts };
  await db.transaction(async (tx) => {
    const list = await tx.select().from(deals).where(and(inArray(deals.id, ids), sql`${deals.archivedAt} is not null`, scope.onlyOwnerId ? or(eq(deals.ownerId, scope.onlyOwnerId), isNull(deals.ownerId)) : undefined)).for("update");
    for (const d of list) {
      if (!d.closedAt && (await findOpenDeal(d.contactId, tx))) { conflicts.push(d.id); continue; }
      await tx.update(deals).set({
        archivedAt: null, archivedBy: null, archivedStageId: null,
        stageId: d.archivedStageId ?? d.stageId,
        // Mensagens que chegaram (ou saíram pelo celular) enquanto estava arquivado entram na conta da espera.
        lastInboundAt: sql`greatest(${deals.lastInboundAt}, (select max(m.created_at) from messages m where m.deal_id = ${d.id} and m.direction = 'in'))`,
        lastOutboundAt: sql`greatest(${deals.lastOutboundAt}, (select max(m.created_at) from messages m where m.deal_id = ${d.id} and m.direction = 'out'))`,
      }).where(eq(deals.id, d.id));
      if (!d.closedAt) {
        await tx.execute(sql`update deals set awaiting_reply_since = case
            when last_inbound_at > coalesce(last_outbound_at, '-infinity'::timestamptz)
            then coalesce(awaiting_reply_since, (select min(m.created_at) from messages m where m.deal_id = ${d.id} and m.direction = 'in'
              and m.created_at > coalesce(deals.last_outbound_at, '-infinity'::timestamptz)))
            else null end
          where id = ${d.id}`);
      }
      await tx.update(contacts).set({ ignored: false }).where(eq(contacts.id, d.contactId));
      await logEvent(tx, d.id, "restaurado", { etapa: d.archivedStageId ?? d.stageId }, userId);
      await tx.insert(auditLog).values({ userId, action: "restaurou_lead", entity: "deal", entityId: d.id, data: { contactId: d.contactId } });
      restored.push(d.id);
    }
  });
  for (const id of restored) await emit("lead_restaurado", { dealId: id });
  return { restored: restored.length, conflicts };
}
