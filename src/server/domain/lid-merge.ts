import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contactMerges, contacts, deals, messages, tasks } from "../db/schema";
import { emit, logEvent } from "./events";
import { moveContactDataTx } from "./merge-contacts";

export type LidMergeResult = { merged?: true; renamed?: true; learned?: true; nothing?: true; dealId?: string | null };

/**
 * Junta o contato de número oculto (@lid) com o do número de verdade, quando o WhatsApp revela que são a mesma pessoa.
 * Caso típico: a cliente escreve pelo número e a Casa responde pelo ChatGuru/celular, mas o eco da resposta chega só com o @lid: a
 * resposta caía num contato "Número oculto" e a conversa da cliente ficava "atrasada". Aqui as mensagens, conversas, etiquetas e
 * tarefas do oculto passam para o contato do número, a espera é recalculada (se a última mensagem é da Casa, não está mais esperando)
 * e o contato do número guarda o @lid para as próximas. Idempotente.
 */
export async function mergeLidInto(lid: string, phone: string): Promise<LidMergeResult> {
  const result = await db.transaction(async (tx): Promise<LidMergeResult> => {
    const [hidden] = await tx.select().from(contacts).where(eq(contacts.waLid, lid));
    const [real] = await tx.select().from(contacts).where(eq(contacts.phoneE164, phone));
    if (!hidden || hidden.id === real?.id) {
      if (real && !real.waLid && !hidden) { await tx.update(contacts).set({ waLid: lid }).where(eq(contacts.id, real.id)); return { learned: true }; }
      return { nothing: true };
    }
    if (!real) {
      await tx.update(contacts).set({ phoneE164: phone }).where(eq(contacts.id, hidden.id));
      return { renamed: true };
    }
    // Conversa que fica: a aberta do número; se não houver, a aberta do oculto passa a ser dela.
    const openOf = async (contactId: string) => (await tx.select().from(deals)
      .where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).orderBy(desc(deals.createdAt)).limit(1))[0];
    const realOpen = await openOf(real.id);
    const hiddenOpen = await openOf(hidden.id);
    const hiddenDeals = await tx.select({ id: deals.id }).from(deals).where(eq(deals.contactId, hidden.id));
    const target = realOpen ?? hiddenOpen ?? null;
    if (realOpen && hiddenOpen) {
      // Duas conversas abertas: as mensagens do oculto vão para a da cliente; a do oculto sai (arquivada, nada se apaga).
      await tx.update(messages).set({ dealId: realOpen.id }).where(eq(messages.dealId, hiddenOpen.id));
      await tx.update(tasks).set({ dealId: realOpen.id }).where(and(eq(tasks.dealId, hiddenOpen.id), isNull(tasks.doneAt)));
      await tx.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.dealId, hiddenOpen.id), isNull(alerts.resolvedAt)));
      await tx.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, hiddenOpen.id));
      // O lead que sai fica com o registro da junção (a ficha mostra "Mesclado", não "Não é cliente").
      await logEvent(tx, hiddenOpen.id, "contato_mesclado", { lid, para: realOpen.id });
    }
    // Conversas arquivadas do oculto (os ecos da Casa guardados em silêncio): agora o número é conhecido, então viram a conversa da cliente
    // (a mais recente volta a abrir, se ela não tinha conversa aberta) e as mensagens vão todas para ela.
    const quietIds = hiddenDeals.map((d) => d.id).filter((id) => id !== hiddenOpen?.id);
    let keep = target;
    if (!keep && quietIds.length) {
      const [latest] = await tx.select().from(deals).where(inArray(deals.id, quietIds)).orderBy(desc(deals.createdAt)).limit(1);
      if (latest) { await tx.update(deals).set({ archivedAt: null }).where(eq(deals.id, latest.id)); keep = { ...latest, archivedAt: null }; }
    }
    const others = quietIds.filter((id) => id !== keep?.id);
    if (keep && others.length) await tx.update(messages).set({ dealId: keep.id }).where(inArray(messages.dealId, others));
    if (hiddenDeals.length) await tx.update(deals).set({ contactId: real.id }).where(inArray(deals.id, hiddenDeals.map((d) => d.id)));
    await tx.update(messages).set({ contactId: real.id }).where(eq(messages.contactId, hidden.id));
    // Todo o resto da cliente (agenda, comandas, fichas, fotos, notas, pacotes, etiquetas, tarefas…) vai junto, como na junção de cadastros:
    // antes iam só tarefas, fichas técnicas, pesquisa e etiquetas, e o banco recusava apagar o oculto com horário na agenda (26/10).
    await moveContactDataTx(tx, hidden.id, real.id, new Date());
    // Unir cadastros (0086): as junções que caíam no oculto passam a cair no número (a cadeia continua).
    await tx.update(contactMerges).set({ keptId: real.id }).where(eq(contactMerges.keptId, hidden.id));
    await tx.delete(contacts).where(eq(contacts.id, hidden.id));
    await tx.update(contacts).set({ waLid: lid, name: sql`coalesce(${contacts.name}, ${hidden.name})` }).where(eq(contacts.id, real.id));
    if (keep) {
      // Continua Resolvida só se todas as conversas abertas juntadas estavam Resolvidas (02/11).
      const opened = [realOpen, hiddenOpen].filter((d) => !!d);
      await recomputeWaitTx(tx, keep, { keepResolved: opened.length > 0 && opened.every((d) => !!d.conversationArchivedAt) });
      await logEvent(tx, keep.id, "contato_mesclado", { lid });
    }
    return { merged: true, dealId: keep?.id ?? null };
  });
  if (result.dealId) await emit("lead_atualizado", { dealId: result.dealId });
  return result;
}

/**
 * Resposta de verdade da Casa (02/11): gente da equipe (CRM ou celular), sem falhar. Automática (fora do horário, boas-vindas, menu,
 * lembrete) e ligação registrada não respondem a cliente, a mesma regra de `recordOutbound`.
 */
const HUMAN_REPLY = sql`direction = 'out' and status <> 'failed' and kind <> 'call' and (sent_by_user_id is not null or from_phone)`;

/**
 * Recalcula a espera pela conversa inteira (depois de juntar mensagens de dois contatos): a primeira mensagem da cliente sem resposta
 * humana depois dela. Respondida: os avisos de espera da conversa ficam resolvidos. Usado pelo @lid e pelo Unir cadastros.
 * `keepResolved`: todas as conversas juntadas estavam Resolvidas, então continua Resolvida e sem espera. Senão, se a espera reabre, a
 * conversa sai do Resolvido, como em `recordInbound` (02/11: a cliente esperando no número oculto sumia dentro da conversa Resolvida).
 */
export async function recomputeWaitTx(tx: Tx, target: { id: string; awaitingReplySince: Date | null }, opts: { keepResolved?: boolean } = {}) {
  const [last] = (await tx.execute(sql`select
      (select max(created_at) from messages where deal_id = ${target.id} and direction = 'in') as last_in,
      (select max(created_at) from messages where deal_id = ${target.id} and direction = 'out') as last_out,
      (select max(created_at) from messages where deal_id = ${target.id} and ${HUMAN_REPLY}) as last_reply,
      (select min(created_at) from messages where deal_id = ${target.id} and direction = 'in'
         and created_at > coalesce((select max(created_at) from messages where deal_id = ${target.id} and ${HUMAN_REPLY}), '-infinity'::timestamptz)) as first_unanswered`)).rows as { last_in: Date | null; last_out: Date | null; last_reply: Date | null; first_unanswered: Date | null }[];
  const lastIn = last?.last_in ? new Date(last.last_in) : null, lastOut = last?.last_out ? new Date(last.last_out) : null, lastReply = last?.last_reply ? new Date(last.last_reply) : null;
  const answered = !!lastReply && (!lastIn || lastReply >= lastIn);
  const [d] = await tx.select({ resolvedAt: deals.conversationArchivedAt }).from(deals).where(eq(deals.id, target.id));
  const stayResolved = !!d?.resolvedAt && !!opts.keepResolved;
  const awaiting = answered || stayResolved ? null : (last?.first_unanswered ? new Date(last.first_unanswered) : target.awaitingReplySince);
  const reopen = !!d?.resolvedAt && !!awaiting;
  await tx.update(deals).set({
    lastInboundAt: lastIn, lastOutboundAt: lastOut, awaitingReplySince: awaiting,
    ...(reopen ? { conversationArchivedAt: null } : {}),
  }).where(eq(deals.id, target.id));
  if (reopen) await logEvent(tx, target.id, "conversa_desarquivada", { motivo: "contato_mesclado" });
  if (answered) await tx.update(alerts).set({ resolvedAt: new Date(), readAt: sql`coalesce(${alerts.readAt}, now())` }).where(and(eq(alerts.dealId, target.id), isNull(alerts.resolvedAt)));
}
