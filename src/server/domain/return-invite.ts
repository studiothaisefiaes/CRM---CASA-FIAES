import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { contacts, dealEvents, deals, messages, users } from "../db/schema";
import { cancelAttemptTaskTx } from "./attempts";
import { detectOrigin, findOpenDeal, moveToKindTx, stageByKind } from "./deals";
import { emit, logEvent } from "./events";

/** Sem resposta ao convite em tantos dias: a conversa volta a ficar encerrada. */
export const RETURN_INVITE_DAYS = 14;
/** O selo da Fila enquanto o convite espera a resposta. */
export const RETURN_INVITE_BADGE = "Convite de retorno";

/**
 * Convite de retorno (mensagem em massa) entregue a quem estava com a conversa encerrada: a conversa ABRE em Em conversa esperando a cliente,
 * com o selo "Convite de retorno" e SEM tentativas (a Casa já escreveu; não nasce combinado). Sem conversa no CRM, abre uma nova do mesmo jeito.
 * A mensagem enviada passa a ser dessa conversa. Responder segue o caminho normal da mensagem recebida (e o selo some).
 */
export async function openReturnInviteTx(tx: Tx, contactId: string, messageId: string, at: Date): Promise<string> {
  const conversa = await stageByKind("atendimento", tx);
  let deal = await findOpenDeal(contactId, tx);
  if (deal) {
    if (deal.followupAttempt > 0 || deal.followupTaskId) await cancelAttemptTaskTx(tx, deal, null, at);
    await tx.update(deals).set({ conversationArchivedAt: null, awaitingReplySince: null, followupAttempt: 0, followupDueAt: null, followupTaskId: null })
      .where(eq(deals.id, deal.id));
    if (deal.stageId === conversa.id) await tx.update(deals).set({ stageEnteredAt: at }).where(eq(deals.id, deal.id));
    else await moveToKindTx(tx, deal.id, "atendimento", null, "convite_retorno", at, { noAttempts: true });
    await logEvent(tx, deal.id, "conversa_desarquivada", { motivo: "convite_retorno" });
  } else {
    const [c] = await tx.select({ isClient: contacts.isClient }).from(contacts).where(eq(contacts.id, contactId));
    // A dona da última conversa, se ainda está na equipe.
    const [last] = await tx.select({ ownerId: deals.ownerId }).from(deals).innerJoin(users, eq(users.id, deals.ownerId))
      .where(and(eq(deals.contactId, contactId), eq(users.active, true))).orderBy(sql`${deals.createdAt} desc`).limit(1);
    [deal] = await tx.insert(deals).values({ contactId, stageId: conversa.id, ownerId: last?.ownerId ?? null, origin: detectOrigin({ isClient: c?.isClient }),
      createdAt: at, stageEnteredAt: at, lastOutboundAt: at }).returning();
    await logEvent(tx, deal.id, "lead_criado", { origin: deal.origin, initialStage: conversa.key, historico: false, iniciadoPelaCasa: true, conviteRetorno: true });
  }
  await tx.update(messages).set({ dealId: deal.id }).where(and(eq(messages.id, messageId), isNull(messages.dealId)));
  await tx.update(deals).set({ lastOutboundAt: sql`greatest(${deals.lastOutboundAt}, ${at.toISOString()}::timestamptz)` }).where(eq(deals.id, deal.id));
  // Com a hora do envio (a mesma da entrada na etapa): o selo vale enquanto o convite é desta espera.
  await tx.insert(dealEvents).values({ dealId: deal.id, type: "convite_retorno", payload: { messageId }, createdAt: at });
  return deal.id;
}

/** Condição SQL do selo: conversa esperando a resposta ao convite (o convite é desta espera e a cliente ainda não escreveu depois dele). */
export const returnInviteActive = (dealId: unknown) => sql<boolean>`exists (select 1 from deal_events ri join deals rd on rd.id = ri.deal_id join stages rs on rs.id = rd.stage_id
  where ri.deal_id = ${dealId} and ri.type = 'convite_retorno' and rs.kind in ('followup', 'atendimento') and ri.created_at >= rd.stage_entered_at
    and not exists (select 1 from messages rm where rm.deal_id = rd.id and rm.direction = 'in' and rm.created_at > ri.created_at))`;

/** Worker: convite sem resposta há 14 dias volta a ser conversa encerrada (sai da Fila). Devolve quantas. */
export async function expireReturnInvites(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - RETURN_INVITE_DAYS * 86_400_000).toISOString();
  const rows = (await db.execute(sql`
    select d.id from deals d join stages s on s.id = d.stage_id
     where s.kind in ('followup', 'atendimento') and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null
       and d.stage_entered_at <= ${limit}::timestamptz
       and exists (select 1 from deal_events e where e.deal_id = d.id and e.type = 'convite_retorno' and e.created_at >= d.stage_entered_at)
       and not exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'in' and m.created_at > d.stage_entered_at)`)).rows as { id: string }[];
  for (const r of rows) {
    await db.transaction(async (tx) => {
      await tx.update(deals).set({ conversationArchivedAt: now }).where(eq(deals.id, r.id));
      await logEvent(tx, r.id, "conversa_arquivada", { motivo: "convite_sem_resposta", dias: RETURN_INVITE_DAYS });
    });
    await emit("lead_atualizado", { dealId: r.id });
  }
  return rows.length;
}
