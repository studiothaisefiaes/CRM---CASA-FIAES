import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, settings } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { getBusinessHours } from "./hours";
import { specialDayText } from "./special-days";
import { isQuiet } from "./quiet";
import { AUTO_REPLY_SOURCE, enqueueAutomated } from "./outbox";
import { fillName, fillOpening } from "../../lib/auto-message-text";

/** Mesmo contato só recebe a resposta fora do horário uma vez a cada 12 h. */
export const AUTO_REPLY_GAP_MS = 12 * 3_600_000;
/** Mensagem mais velha que isso (webhook reprocessado, worker parado) não recebe resposta de "estamos fechados". */
export const AUTO_REPLY_MAX_AGE_MS = 10 * 60_000;

/**
 * Resposta automática de fora do expediente. Chamada depois do commit de `recordInbound` (nunca derruba a ingestão).
 * Só enfileira se `settings.auto_resposta.enabled`, se a Casa está fechada em `at`, se esta é a primeira mensagem da cliente
 * nesta espera e se o contato não recebeu resposta automática nas últimas 12 h. Quem envia é a fila (`drainOutbox`).
 * Mensagem de histórico importado e as enviadas pela Casa não passam por aqui (só `recordInbound` chama).
 */
export async function maybeAutoReply(dealId: string, at: Date, now: Date = new Date()): Promise<boolean> {
  const [cfg] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "auto_resposta"));
  const conf = cfg?.value as { enabled?: boolean; text?: string } | undefined;
  if (!conf?.enabled) return false;
  const text = (await specialDayText(at.getTime())) ?? conf.text?.trim(); // o dia especial com texto próprio vence o texto de sempre
  if (!text) return false;
  if (now.getTime() - at.getTime() > AUTO_REPLY_MAX_AGE_MS) return false;
  const hours = await getBusinessHours();
  if (isOpen(at.getTime(), hours) || isOpen(now.getTime(), hours)) return false; // fechada quando a cliente escreveu E agora

  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row || row.deal.archivedAt || row.contact.kind !== "cliente") return false;
  // Primeira mensagem desta espera: a espera começou exatamente nesta mensagem.
  if (row.deal.awaitingReplySince?.getTime() !== at.getTime()) return false;
  if (await isQuiet(row.deal.channelId, at)) return false;

  return db.transaction(async (tx) => {
    // Reserva a janela de 12 h de forma atômica: duas mensagens ao mesmo tempo geram uma só resposta.
    const claimed = await tx.update(contacts).set({ lastAutoReplyAt: at })
      .where(sql`${contacts.id} = ${row.contact.id} and (${contacts.lastAutoReplyAt} is null or ${contacts.lastAutoReplyAt} <= ${new Date(at.getTime() - AUTO_REPLY_GAP_MS).toISOString()}::timestamptz)`)
      .returning({ id: contacts.id });
    if (!claimed.length) return false;
    // {abertura}: o prazo concreto ("amanhã a partir das 9h") pelo expediente de verdade, na hora em que ela escreveu.
    await enqueueAutomated({ dealId, kind: "text", text: fillName(fillOpening(text, at.getTime(), hours), row.contact.name), source: AUTO_REPLY_SOURCE, guard: { awaitingSince: at }, at: now }, tx);
    return true;
  });
}
