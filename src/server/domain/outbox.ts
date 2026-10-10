import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, pool, type Tx } from "../db";
import { alerts, automations, contacts, deals, messages, outbox, settings, stages, type OutboxItem } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { deliverAutomated, NotSentError, resolveChannel, SendError, UncertainSendError, UNCERTAIN_SEND_MESSAGE } from "./send";
import { getBusinessHours } from "./hours";
import { isQuiet } from "./quiet";

/** Teto de envios automáticos por hora (configurável em `settings.envio_teto_hora`). */
export const DEFAULT_ENVIO_TETO_HORA = 30;
/** No máximo 3 tentativas por item; a espera cresce a cada falha (minutos após a 1ª e a 2ª). */
export const MAX_SEND_ATTEMPTS = 3;
const BACKOFF_MIN = [5, 30];
/** Item preso em "enviando" (worker caiu no meio): não reenvia sozinho, para não duplicar, e marca como falho. */
const STUCK_AFTER_MS = 15 * 60_000;
export const AUTO_REPLY_SOURCE = "auto_resposta";
/** Resposta fora do horário que ficou mais que isso na fila perdeu a hora: cancela. */
export const AUTO_REPLY_MAX_QUEUE_MS = 30 * 60_000;
/** Cadeado (advisory) que mantém um único `drainOutbox` por vez, para o teto por hora valer. */
export const OUTBOX_LOCK_KEY = 7_120_012;

/** O que valia ao enfileirar. Na hora de enviar, se mudou, o item é cancelado. */
export type EnqueueGuard = {
  /** Resposta fora do horário: desde quando a cliente esperava (`deals.awaiting_reply_since`). */
  awaitingSince?: Date;
  /** Lembrete/enquete: o agendamento e a etapa do lead quando o gatilho disparou. */
  scheduledAt?: Date | null;
  stage?: string;
};

export type EnqueueInput = {
  dealId: string; kind: "text" | "poll"; text: string;
  /** Opções da enquete (2 a 10). */
  options?: string[];
  /** De onde veio: "automacao:<id da automação>" ou "auto_resposta". Reconferido na hora de enviar. */
  source?: string;
  guard?: EnqueueGuard;
  notBefore?: Date;
  /** Instante do enfileiramento (padrão: agora do banco). */
  at?: Date;
};

type Stored = OutboxItem["options"];
type Meta = Exclude<Stored, string[] | null | undefined>;
const packOptions = (values?: string[], source?: string, guard?: EnqueueGuard): Stored => {
  const meta: Meta = {
    ...(values ? { values } : {}), ...(source ? { source } : {}),
    ...(guard?.awaitingSince ? { awaiting: guard.awaitingSince.toISOString() } : {}),
    ...(guard?.scheduledAt ? { scheduledAt: guard.scheduledAt.toISOString() } : {}),
    ...(guard?.stage ? { stage: guard.stage } : {}),
  };
  const keys = Object.keys(meta);
  if (keys.length === 0) return null;
  return keys.length === 1 && keys[0] === "values" ? meta.values! : meta;
};
const unpackOptions = (o: Stored): Meta & { values: string[] } => (Array.isArray(o) ? { values: o } : { ...(o ?? {}), values: o?.values ?? [] });

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
    dealId: input.dealId, kind: input.kind, text, options: packOptions(input.kind === "poll" ? input.options : undefined, input.source, input.guard),
    ...(input.at ? { createdAt: input.at } : {}),
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

async function processItem(item: OutboxItem, now: Date, open: boolean): Promise<Outcome> {
  const cancel = async (reason: string): Promise<Outcome> => { await finish(item.id, { status: "cancelled", error: reason }); return "cancelled"; };
  const meta = unpackOptions(item.options);
  const { values, source } = meta;

  const [row] = await db.select({ deal: deals, contact: contacts, stageKey: stages.key }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, item.dealId));
  if (!row) return cancel("Lead não existe mais.");
  if (row.deal.archivedAt) return cancel("O lead foi arquivado.");
  if (row.contact.ignored) return cancel("O contato está marcado como 'não é cliente'.");

  if (source === AUTO_REPLY_SOURCE) {
    const [s] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "auto_resposta"));
    if (!(s?.value as { enabled?: boolean } | undefined)?.enabled) return cancel("A resposta fora do horário foi desligada.");
    if (open) return cancel("A Casa já abriu: a resposta fora do horário perdeu o sentido.");
    if (now.getTime() - item.createdAt.getTime() > AUTO_REPLY_MAX_QUEUE_MS) return cancel("A resposta automática ficou mais de 30 minutos na fila.");
    if (!row.deal.awaitingReplySince || row.deal.awaitingReplySince.toISOString() !== meta.awaiting) return cancel("A cliente já foi atendida ou a espera mudou.");
  } else if (source?.startsWith("automacao:")) {
    const [a] = await db.select({ enabled: automations.enabled }).from(automations).where(eq(automations.id, source.slice("automacao:".length)));
    if (!a?.enabled) return cancel("A automação foi desligada.");
  }
  // Lembrete/enquete de agendamento: o gatilho ainda precisa valer na hora de enviar.
  if (meta.scheduledAt || meta.stage) {
    if (row.deal.closedAt) return cancel("O lead foi fechado.");
    if (meta.stage && row.stageKey !== meta.stage) return cancel("O lead saiu da etapa em que a automação disparou.");
    if (meta.scheduledAt) {
      if (!row.deal.scheduledAt || row.deal.scheduledAt.getTime() !== new Date(meta.scheduledAt).getTime()) return cancel("O agendamento mudou.");
      if (row.deal.scheduledAt.getTime() <= now.getTime()) return cancel("O horário agendado já passou.");
    }
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
  let delivered;
  try {
    delivered = await deliverAutomated(item.dealId, channel, { kind: item.kind === "poll" ? "poll" : "text", text: item.text, options: values }, last,
      (messageId) => saveMessageId(item, messageId));
  } catch (e) {
    // Fail-closed: só reenvia o que está EXPLICITAMENTE marcado como "não saiu" (resposta de erro da Evolution ou falha antes de chamar o provider).
    const notSent = (e instanceof NotSentError) || (e instanceof SendError && !(e instanceof UncertainSendError));
    if (!notSent) { // incerto ou desconhecido: pode ter saído, então NÃO reenvia
      await finish(item.id, { status: "failed", error: e instanceof UncertainSendError ? UNCERTAIN_SEND_MESSAGE : `Erro inesperado no envio: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` });
      await alertInterrupted(item, row.contact.name ?? row.contact.phoneE164, "não teve resposta confiável da Evolution e pode ter saído");
      return "failed";
    }
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
  // A mensagem saiu: nunca mais reenvia. Se o registro no CRM falhou, o erro fica anotado no item.
  await finish(item.id, { status: "sent", sentAt: now, error: delivered.confirmError ? `Enviada, mas o registro no CRM falhou: ${delivered.confirmError}`.slice(0, 300) : null });
  return "sent";
}

/** Guarda no item o id da mensagem pendente da conversa (usado se o item ficar preso). */
async function saveMessageId(item: OutboxItem, messageId: string) {
  const { values, ...rest } = unpackOptions(item.options);
  await finish(item.id, { options: { ...rest, ...(values.length ? { values } : {}), messageId } });
}

async function alertInterrupted(item: OutboxItem, who: string, why: string) {
  await db.insert(alerts).values({ dealId: item.dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info",
    message: `O envio automático para ${who} ${why}. Confira a conversa antes de reenviar.`, dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
}

/** Item que ficou "enviando" (worker caiu no meio): não reenvia, para não duplicar. Marca a conversa e avisa a gestão. */
async function failStuck(now: Date) {
  const stuck = await db.update(outbox).set({ status: "failed", error: "Envio automático interrompido. Confira a conversa antes de reenviar." })
    .where(and(eq(outbox.status, "sending"), lte(outbox.notBefore, new Date(now.getTime() - STUCK_AFTER_MS)))).returning();
  for (const it of stuck) {
    const body = it.kind === "poll" ? `Enquete: ${it.text}` : it.text;
    const messageId = unpackOptions(it.options).messageId;
    const fail = { status: "failed", error: "Envio automático interrompido" };
    // Pelo id guardado; o casamento por corpo é só o plano B (item antigo, sem id).
    await db.update(messages).set(fail).where(messageId
      ? and(eq(messages.id, messageId), eq(messages.status, "pending"))
      : and(eq(messages.dealId, it.dealId), eq(messages.direction, "out"), eq(messages.status, "pending"), isNull(messages.externalId), isNull(messages.sentByUserId), eq(messages.body, body)));
    const [c] = await db.select({ name: contacts.name, phone: contacts.phoneE164 }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, it.dealId));
    await alertInterrupted(it, c?.name ?? c?.phone ?? "a cliente", "foi interrompido");
  }
}

/**
 * Worker (a cada minuto): envia os itens vencidos da fila, no máximo `settings.envio_teto_hora` por hora (padrão 30).
 * Antes de cada envio reconfere lead, contato, canal, modo quieto e se a automação de origem ainda está ligada.
 */
export async function drainOutbox(now = new Date()): Promise<{ sent: number; cancelled: number; retry: number; failed: number; skipped?: boolean }> {
  // Um drain por vez: com dois em paralelo o teto por hora seria contado duas vezes. Cadeado de sessão numa conexão só dele.
  const lock = await pool.connect();
  let destroy: Error | undefined; // se o cadeado não puder ser solto, a conexão é destruída em vez de voltar ao pool com ele preso
  try {
    let got: boolean;
    try { got = (await lock.query("select pg_try_advisory_lock($1::bigint) as ok", [OUTBOX_LOCK_KEY])).rows[0].ok; }
    catch (e) { destroy = e instanceof Error ? e : new Error(String(e)); throw e; }
    if (!got) return { sent: 0, cancelled: 0, retry: 0, failed: 0, skipped: true };
    try { return await drainLocked(now); }
    finally { await lock.query("select pg_advisory_unlock($1::bigint)", [OUTBOX_LOCK_KEY]).catch((e: unknown) => { destroy = e instanceof Error ? e : new Error(String(e)); }); }
  } finally { lock.release(destroy); }
}

async function drainLocked(now: Date) {
  const summary = { sent: 0, cancelled: 0, retry: 0, failed: 0 };
  await failStuck(now);
  const teto = await envioTeto();
  const since = new Date(now.getTime() - 3_600_000).toISOString(), nowIso = now.toISOString();
  // Enviados na última hora + os que estão sendo enviados agora ("enviando" guarda em `not_before` o instante da reserva).
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from outbox
    where (status = 'sent' and sent_at > ${since}::timestamptz and sent_at <= ${nowIso}::timestamptz)
       or (status = 'sending' and not_before > ${since}::timestamptz)`)).rows as { n: number }[];
  let room = teto - n;
  const open = isOpen(now.getTime(), await getBusinessHours());
  for (let guard = 0; room > 0 && guard < 500; guard++) {
    const item = await claimNext(now, open);
    if (!item) break;
    let r: Outcome;
    try { r = await processItem(item, now, open); }
    catch (e) { // erro inesperado (banco): não deixa o item "enviando" para sempre
      await finish(item.id, { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).catch(() => {});
      r = "failed";
    }
    summary[r]++;
    if (r === "sent") room--;
  }
  return summary;
}
