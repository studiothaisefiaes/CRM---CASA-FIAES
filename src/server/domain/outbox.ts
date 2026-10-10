import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, automations, contacts, deals, outbox, settings, type OutboxItem } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { deliverAutomated, resolveChannel, SendError } from "./send";
import { getBusinessHours } from "./hours";
import { isQuiet } from "./quiet";

/** Teto de envios automáticos por hora (configurável em `settings.envio_teto_hora`). */
export const DEFAULT_ENVIO_TETO_HORA = 20;
/** No máximo 3 tentativas por item; a espera cresce a cada falha (minutos após a 1ª e a 2ª). */
export const MAX_SEND_ATTEMPTS = 3;
const BACKOFF_MIN = [5, 30];
/** Item preso em "enviando" (worker caiu no meio): não reenvia sozinho, para não duplicar, e marca como falho. */
const STUCK_AFTER_MS = 15 * 60_000;
export const AUTO_REPLY_SOURCE = "auto_resposta";

export type EnqueueInput = {
  dealId: string; kind: "text" | "poll"; text: string;
  /** Opções da enquete (2 a 10). */
  options?: string[];
  /** De onde veio: "automacao:<id da automação>" ou "auto_resposta". Reconferido na hora de enviar. */
  source?: string;
  notBefore?: Date;
};

type Stored = OutboxItem["options"];
const packOptions = (values?: string[], source?: string): Stored => (!source ? (values ?? null) : { ...(values ? { values } : {}), source });
const unpackOptions = (o: Stored): { values: string[]; source: string | null } =>
  Array.isArray(o) ? { values: o, source: null } : { values: o?.values ?? [], source: o?.source ?? null };

/** Põe uma mensagem automática na fila. Quem envia é o worker (`drainOutbox`), respeitando o teto por hora. */
export async function enqueueAutomated(input: EnqueueInput, tx: Tx | typeof db = db): Promise<string> {
  const text = input.text.trim();
  if (!text) throw new Error("A mensagem automática está vazia.");
  if (input.kind === "poll") {
    const n = input.options?.length ?? 0;
    if (n < 2 || n > 10 || new Set(input.options).size !== n) throw new Error("A enquete precisa de 2 a 10 opções diferentes.");
    if (text.length > 255) throw new Error("O título da enquete passa de 255 caracteres.");
  } else if (text.length > 4000) throw new Error("Mensagem muito longa (máximo 4.000 caracteres).");
  const [row] = await tx.insert(outbox).values({
    dealId: input.dealId, kind: input.kind, text, options: packOptions(input.kind === "poll" ? input.options : undefined, input.source),
    // Sem espera: "disponível desde sempre". Assim a ordem é a de chegada (createdAt) e não depende do relógio de quem enfileirou.
    notBefore: input.notBefore ?? new Date(0),
  }).returning({ id: outbox.id });
  return row.id;
}

async function envioTeto(): Promise<number> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "envio_teto_hora"));
  const n = Number(r?.value);
  return r && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ENVIO_TETO_HORA;
}

/** Reserva o próximo item (FOR UPDATE SKIP LOCKED) e já o marca "enviando" antes de qualquer envio: dois workers nunca pegam o mesmo. */
async function claimNext(now: Date, open: boolean): Promise<OutboxItem | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(outbox)
      .where(and(eq(outbox.status, "pending"), lte(outbox.notBefore, now),
        // Com a Casa fechada só sai a resposta automática; lembretes e enquetes esperam abrir.
        open ? undefined : sql`${outbox.options}->>'source' = ${AUTO_REPLY_SOURCE}`))
      .orderBy(asc(outbox.notBefore), asc(outbox.createdAt)).limit(1).for("update", { skipLocked: true });
    if (!row) return null;
    // `notBefore` guarda o instante da reserva enquanto o item está "enviando" (usado para achar itens presos).
    const [up] = await tx.update(outbox).set({ status: "sending", attempts: sql`${outbox.attempts} + 1`, notBefore: now }).where(eq(outbox.id, row.id)).returning();
    return up;
  });
}

type Outcome = "sent" | "cancelled" | "retry" | "failed";

async function finish(id: string, set: Partial<typeof outbox.$inferInsert>) { await db.update(outbox).set(set).where(eq(outbox.id, id)); }

async function processItem(item: OutboxItem, now: Date): Promise<Outcome> {
  const cancel = async (reason: string): Promise<Outcome> => { await finish(item.id, { status: "cancelled", error: reason }); return "cancelled"; };
  const { values, source } = unpackOptions(item.options);

  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, item.dealId));
  if (!row) return cancel("Lead não existe mais.");
  if (row.deal.archivedAt) return cancel("O lead foi arquivado.");
  if (row.contact.ignored) return cancel("O contato está marcado como 'não é cliente'.");

  if (source === AUTO_REPLY_SOURCE) {
    const [s] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "auto_resposta"));
    if (!(s?.value as { enabled?: boolean } | undefined)?.enabled) return cancel("A resposta fora do horário foi desligada.");
  } else if (source?.startsWith("automacao:")) {
    const [a] = await db.select({ enabled: automations.enabled }).from(automations).where(eq(automations.id, source.slice("automacao:".length)));
    if (!a?.enabled) return cancel("A automação foi desligada.");
  }

  let channel;
  try { channel = await resolveChannel(item.dealId, row.deal); }
  catch (e) {
    if (!(e instanceof SendError)) throw e;
    await db.insert(alerts).values({ dealId: item.dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info",
      message: `Não foi possível enviar a mensagem automática para ${row.contact.name ?? row.contact.phoneE164}: WhatsApp desconectado.`, dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
    return cancel(e.message);
  }
  if (channel && await isQuiet(channel.id, now)) return cancel("O WhatsApp está em modo quieto (histórico recém-importado).");

  const last = item.attempts >= MAX_SEND_ATTEMPTS;
  try {
    await deliverAutomated(item.dealId, channel, { kind: item.kind === "poll" ? "poll" : "text", text: item.text, options: values }, last);
    await finish(item.id, { status: "sent", sentAt: now, error: null });
    return "sent";
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!last) {
      await finish(item.id, { status: "pending", error: msg, notBefore: new Date(now.getTime() + BACKOFF_MIN[item.attempts - 1] * 60_000) });
      return "retry";
    }
    await finish(item.id, { status: "failed", error: msg });
    await db.insert(alerts).values({ dealId: item.dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info",
      message: `Não foi possível enviar a mensagem automática para ${row.contact.name ?? row.contact.phoneE164} depois de ${item.attempts} tentativas: ${msg.slice(0, 120)}`,
      dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
    return "failed";
  }
}

/**
 * Worker (a cada minuto): envia os itens vencidos da fila, no máximo `settings.envio_teto_hora` por hora (padrão 20).
 * Antes de cada envio reconfere lead, contato, canal, modo quieto e se a automação de origem ainda está ligada.
 */
export async function drainOutbox(now = new Date()) {
  const summary = { sent: 0, cancelled: 0, retry: 0, failed: 0 };
  await db.update(outbox).set({ status: "failed", error: "Interrompido durante o envio. Confira a conversa antes de reenviar." })
    .where(and(eq(outbox.status, "sending"), lte(outbox.notBefore, new Date(now.getTime() - STUCK_AFTER_MS))));
  const teto = await envioTeto();
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from outbox where status = 'sent' and sent_at > ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz and sent_at <= ${now.toISOString()}::timestamptz`)).rows as { n: number }[];
  let room = teto - n;
  const open = isOpen(now.getTime(), await getBusinessHours());
  for (let guard = 0; room > 0 && guard < 500; guard++) {
    const item = await claimNext(now, open);
    if (!item) break;
    let r: Outcome;
    try { r = await processItem(item, now); }
    catch (e) { // erro inesperado (banco): não deixa o item "enviando" para sempre
      await finish(item.id, { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).catch(() => {});
      r = "failed";
    }
    summary[r]++;
    if (r === "sent") room--;
  }
  return summary;
}
