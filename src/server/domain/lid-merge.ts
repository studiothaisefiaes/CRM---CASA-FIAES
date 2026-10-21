import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, clientNotes, contactMerges, contacts, contactTags, deals, messages, satisfactionAnswers, tasks } from "../db/schema";
import { emit, logEvent } from "./events";

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
    await tx.update(tasks).set({ contactId: real.id }).where(eq(tasks.contactId, hidden.id));
    // Lote 7A: a ficha técnica (anotações para a profissional) vai junto.
    await tx.update(clientNotes).set({ contactId: real.id }).where(eq(clientNotes.contactId, hidden.id));
    // Fase B: as respostas da Pesquisa de satisfação também (a linha apaga em cascata com o contato).
    await tx.update(satisfactionAnswers).set({ contactId: real.id }).where(eq(satisfactionAnswers.contactId, hidden.id));
    await tx.execute(sql`insert into contact_tags (contact_id, tag_id, created_by, created_at)
      select ${real.id}::uuid, tag_id, created_by, created_at from contact_tags where contact_id = ${hidden.id}::uuid on conflict do nothing`);
    await tx.delete(contactTags).where(eq(contactTags.contactId, hidden.id));
    // Pessoas a mais do número oculto (filha, mãe…, 0051) passam para o número da cliente.
    await tx.update(contacts).set({ sharesPhoneWith: real.id }).where(eq(contacts.sharesPhoneWith, hidden.id));
    // Unir cadastros (0086): as junções que caíam no oculto passam a cair no número (a cadeia continua).
    await tx.update(contactMerges).set({ keptId: real.id }).where(eq(contactMerges.keptId, hidden.id));
    await tx.delete(contacts).where(eq(contacts.id, hidden.id));
    await tx.update(contacts).set({ waLid: lid, name: sql`coalesce(${contacts.name}, ${hidden.name})` }).where(eq(contacts.id, real.id));
    if (keep) {
      await recomputeWaitTx(tx, keep);
      await logEvent(tx, keep.id, "contato_mesclado", { lid });
    }
    return { merged: true, dealId: keep?.id ?? null };
  });
  if (result.dealId) await emit("lead_atualizado", { dealId: result.dealId });
  return result;
}

/**
 * Recalcula a espera pela conversa inteira (depois de juntar mensagens de dois contatos): a última mensagem da cliente sem resposta
 * depois dela. Respondida: os avisos de espera da conversa ficam resolvidos. Usado pelo @lid e pelo Unir cadastros.
 */
export async function recomputeWaitTx(tx: Tx, target: { id: string; awaitingReplySince: Date | null }) {
  const [last] = (await tx.execute(sql`select
      (select max(created_at) from messages where deal_id = ${target.id} and direction = 'in') as last_in,
      (select max(created_at) from messages where deal_id = ${target.id} and direction = 'out') as last_out,
      (select min(created_at) from messages where deal_id = ${target.id} and direction = 'in'
         and created_at > coalesce((select max(created_at) from messages where deal_id = ${target.id} and direction = 'out'), '-infinity'::timestamptz)) as first_unanswered`)).rows as { last_in: Date | null; last_out: Date | null; first_unanswered: Date | null }[];
  const lastIn = last?.last_in ? new Date(last.last_in) : null, lastOut = last?.last_out ? new Date(last.last_out) : null;
  const answered = !!lastOut && (!lastIn || lastOut >= lastIn);
  await tx.update(deals).set({
    lastInboundAt: lastIn, lastOutboundAt: lastOut,
    awaitingReplySince: answered ? null : (last?.first_unanswered ? new Date(last.first_unanswered) : target.awaitingReplySince),
  }).where(eq(deals.id, target.id));
  if (answered) await tx.update(alerts).set({ resolvedAt: new Date(), readAt: sql`coalesce(${alerts.readAt}, now())` }).where(and(eq(alerts.dealId, target.id), isNull(alerts.resolvedAt)));
}
