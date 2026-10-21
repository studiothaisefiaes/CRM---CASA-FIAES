import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, users } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { fillName } from "../../lib/auto-message-text";
import { getBusinessHours } from "./hours";
import { isQuiet } from "./quiet";
import { AUTO_REPLY_GAP_MS, AUTO_REPLY_MAX_AGE_MS } from "./auto-reply";
import { enqueueAutomated } from "./outbox";
import { AUTO_MESSAGE_SOURCE, getAutoMessage, type AutoMessageKind } from "./auto-message-settings";

type Row = { deal: typeof deals.$inferSelect; contact: typeof contacts.$inferSelect };
const rowOf = async (dealId: string): Promise<Row | undefined> =>
  (await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId)))[0];

/** Reserva a janela de 12 h do contato (a mesma da "fora do horário") e enfileira, de forma atômica: duas mensagens juntas dão um envio só. */
async function claimAndEnqueue(kind: AutoMessageKind, text: string, row: Row, at: Date, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx.update(contacts).set({ lastAutoReplyAt: at })
      .where(sql`${contacts.id} = ${row.contact.id} and (${contacts.lastAutoReplyAt} is null or ${contacts.lastAutoReplyAt} <= ${new Date(at.getTime() - AUTO_REPLY_GAP_MS).toISOString()}::timestamptz)`)
      .returning({ id: contacts.id });
    if (!claimed.length) return false;
    await enqueueAutomated({ dealId: row.deal.id, kind: "text", text: fillName(text, row.contact.name), source: `${AUTO_MESSAGE_SOURCE}${kind}`, guard: { awaitingSince: at }, at: now }, tx);
    return true;
  });
}

/**
 * Depois de gravar a mensagem da cliente (recordInbound, depois do commit; nunca derruba a ingestão). Com a Casa ABERTA (fechada, quem
 * responde é a "fora do horário") e só quando esta mensagem começou uma espera:
 * - boas-vindas: é a primeira mensagem do contato no CRM;
 * - ausência: ninguém da equipe está Disponível.
 * No máximo uma das duas, e uma resposta automática a cada 12 h por cliente. Mensagem velha (webhook reprocessado) não recebe nada.
 */
export async function afterInbound(input: { dealId: string; created: boolean; at: Date; now?: Date }): Promise<AutoMessageKind | null> {
  const now = input.now ?? new Date();
  if (now.getTime() - input.at.getTime() > AUTO_REPLY_MAX_AGE_MS) return null;
  const [welcome, away] = await Promise.all([getAutoMessage("boas_vindas"), getAutoMessage("ausencia")]);
  const welcomeOn = welcome.enabled && !!welcome.text.trim(), awayOn = away.enabled && !!away.text.trim();
  if (!welcomeOn && !awayOn) return null;
  const hours = await getBusinessHours();
  if (!isOpen(input.at.getTime(), hours) || !isOpen(now.getTime(), hours)) return null;
  const row = await rowOf(input.dealId);
  if (!row || row.deal.archivedAt || row.contact.kind !== "cliente") return null;
  if (row.deal.awaitingReplySince?.getTime() !== input.at.getTime()) return null;
  if (await isQuiet(row.deal.channelId, input.at)) return null;
  if (welcomeOn && input.created) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.contactId, row.contact.id));
    if (n === 1) return (await claimAndEnqueue("boas_vindas", welcome.text, row, input.at, now)) ? "boas_vindas" : null;
  }
  if (awayOn) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.active, true), eq(users.availability, "disponivel")));
    if (n === 0) return (await claimAndEnqueue("ausencia", away.text, row, input.at, now)) ? "ausencia" : null;
  }
  return null;
}

/** Depois de "Encerrar conversa" (depois do commit). Uma por encerramento; nunca para "Não é cliente" nem com o canal em modo quieto. */
export async function afterConversationClosed(dealId: string, now = new Date()): Promise<boolean> {
  const conf = await getAutoMessage("encerramento");
  if (!conf.enabled || !conf.text.trim()) return false;
  const row = await rowOf(dealId);
  if (!row || row.deal.archivedAt || row.contact.kind !== "cliente" || (!row.deal.conversationArchivedAt && !row.deal.closedAt)) return false;
  if (await isQuiet(row.deal.channelId, now)) return false;
  await enqueueAutomated({ dealId, kind: "text", text: fillName(conf.text, row.contact.name), source: `${AUTO_MESSAGE_SOURCE}encerramento`, at: now });
  return true;
}
