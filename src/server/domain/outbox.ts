import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, pool, type Tx } from "../db";
import { alerts, automations, contacts, deals, libraryFiles, messages, outbox, settings, stages, type OutboxItem } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { deliverAutomated, NotSentError, resolveChannel, SendError, UncertainSendError, UNCERTAIN_SEND_MESSAGE } from "./send";
import { getBusinessHours } from "./hours";
import { alertText, clientLabel } from "../../lib/alert-copy";
import { isQuiet } from "./quiet";
import { AUTO_MESSAGE_SOURCE, autoMessageCancelReason } from "./auto-message-settings";
import { automationBlockReason } from "./consent";
import { deliverScheduled, SCHEDULED_SOURCE } from "./scheduled";
import { REMINDER_SOURCE, RESCHEDULED_SOURCE, reminderStillValid } from "./client-link/reminder-check";
import { inReminderWindow } from "../../lib/reminder-d1";
import { WELCOME_REPLY_SOURCE, WELCOME_SOURCE } from "../../lib/welcome-menu-flow";
import { SUMMARY_SOURCE } from "../../lib/summary-whatsapp";
import { AFTER_VISIT_SOURCE, SATISFACTION_HIGH_SOURCE, SURVEY_ALREADY, inAfterVisitWindow, isSatisfactionPoll } from "../../lib/after-visit";

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
  /** Lembrete do horário (Lote 7B): o início da visita quando entrou na fila. */
  visitStart?: Date;
  /** Pesquisa de satisfação pela regra (Task 9): a visita de referência (uma pesquisa só por visita). */
  visitId?: string;
};

export type EnqueueInput = {
  dealId: string; kind: "text" | "poll" | "media"; text: string;
  /** Arquivo da Biblioteca (kind "media"). `text` é a legenda; vazio = o nome do arquivo (foto e vídeo sem legenda saem sem texto). */
  fileId?: string;
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
const packOptions = (values?: string[], source?: string, guard?: EnqueueGuard, fileId?: string, caption?: string): Stored => {
  const meta: Meta = {
    ...(values ? { values } : {}), ...(fileId ? { fileId } : {}), ...(caption ? { caption } : {}), ...(source ? { source } : {}),
    ...(guard?.awaitingSince ? { awaiting: guard.awaitingSince.toISOString() } : {}),
    ...(guard?.scheduledAt ? { scheduledAt: guard.scheduledAt.toISOString() } : {}),
    ...(guard?.stage ? { stage: guard.stage } : {}),
    ...(guard?.visitStart ? { visitStart: guard.visitStart.toISOString() } : {}),
    ...(guard?.visitId ? { visitId: guard.visitId } : {}),
  };
  const keys = Object.keys(meta);
  if (keys.length === 0) return null;
  return keys.length === 1 && keys[0] === "values" ? meta.values! : meta;
};
const unpackOptions = (o: Stored): Meta & { values: string[] } => (Array.isArray(o) ? { values: o } : { ...(o ?? {}), values: o?.values ?? [] });

/** Põe uma mensagem automática na fila. Quem envia é o worker (`drainOutbox`), respeitando o teto por hora. */
export async function enqueueAutomated(input: EnqueueInput, tx: Tx | typeof db = db): Promise<string> {
  let text = input.text.trim();
  let caption: string | undefined;
  if (input.kind === "media") {
    if (!input.fileId) throw new Error("Falta o arquivo da Biblioteca.");
    const [f] = await tx.select({ name: libraryFiles.name }).from(libraryFiles).where(and(eq(libraryFiles.id, input.fileId), isNull(libraryFiles.deletedAt)));
    if (!f) throw new Error("O arquivo saiu da Biblioteca.");
    caption = text || undefined; // a intenção fica em options.caption; `text` (legenda ou nome) é só para exibição
    if (!text) text = f.name;
    if (text.length > 1000) throw new Error("A legenda passa de 1.000 caracteres.");
  }
  if (!text) throw new Error("A mensagem automática está vazia.");
  if (input.kind === "poll") {
    const n = input.options?.length ?? 0;
    if (n < 2 || n > 10 || new Set(input.options).size !== n) throw new Error("A enquete precisa de 2 a 10 opções diferentes.");
    if (text.length > 255) throw new Error("O título da enquete passa de 255 caracteres.");
  } else if (text.length > 4000) throw new Error("Mensagem muito longa (máximo 4.000 caracteres).");
  const [row] = await tx.insert(outbox).values({
    dealId: input.dealId, kind: input.kind, text, options: packOptions(input.kind === "poll" ? input.options : undefined, input.source, input.guard, input.kind === "media" ? input.fileId : undefined, caption),
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
async function claimNext(now: Date, open: boolean, afterWindow: boolean): Promise<OutboxItem | null> {
  // Lote 7B (pedido do dono): o lembrete do horário segue a janela 8h–20h, com a Casa aberta ou não; fora dela, espera.
  const reminder = sql`coalesce(${outbox.options}->>'source', '') like 'lembrete_d1%'`;
  // Fase B: o Depois do atendimento segue a janela própria (Configurações, padrão 8h–20h), do mesmo jeito.
  const afterVisit = sql`starts_with(coalesce(${outbox.options}->>'source', ''), ${AFTER_VISIT_SOURCE})`;
  // Resumo do dia no WhatsApp da gestão (Task 11): sai na hora escolhida mesmo com a Casa fechada (sábado às 19h); é mensagem para a equipe.
  const summary = sql`starts_with(coalesce(${outbox.options}->>'source', ''), ${SUMMARY_SOURCE})`;
  const window = inReminderWindow(now.getTime());
  // Com a Casa fechada só sai a resposta automática; lembretes e enquetes esperam abrir.
  // A mensagem programada pela atendente ("agendada") sai na hora marcada, com a Casa aberta ou não (16/10).
  const closedOk = [sql`${outbox.options}->>'source' in (${AUTO_REPLY_SOURCE}, 'agendada')`, ...(window ? [reminder] : []), ...(afterWindow ? [afterVisit] : []), summary];
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(outbox)
      .where(and(eq(outbox.status, "pending"), lte(outbox.notBefore, now),
        open ? undefined : sql`(${sql.join(closedOk, sql` or `)})`,
        window ? undefined : sql`not ${reminder}`,
        afterWindow ? undefined : sql`not ${afterVisit}`))
      .orderBy(asc(outbox.notBefore), asc(outbox.createdAt)).limit(1).for("update", { skipLocked: true });
    if (!row) return null;
    // `notBefore` guarda o instante da reserva enquanto o item está "enviando" (usado para achar itens presos).
    const [up] = await tx.update(outbox).set({ status: "sending", attempts: sql`${outbox.attempts} + 1`, notBefore: now }).where(eq(outbox.id, row.id)).returning();
    return up;
  });
}

type Outcome = "sent" | "cancelled" | "retry" | "failed";

async function finish(id: string, set: Partial<typeof outbox.$inferInsert>) { await db.update(outbox).set(set).where(eq(outbox.id, id)); }

/** `progress.pending`: a linha pendente já foi criada, então o provider pode ter sido chamado (a mensagem pode ter saído). */
async function processItem(item: OutboxItem, now: Date, open: boolean, progress: { pending: boolean } = { pending: false }): Promise<Outcome> {
  const cancel = async (reason: string): Promise<Outcome> => { await finish(item.id, { status: "cancelled", error: reason }); return "cancelled"; };
  const meta = unpackOptions(item.options);
  const { source } = meta;
  let { values } = meta;
  // Mensagem agendada à mão (Lote 5): regras próprias (cliente escreveu, autora saiu, perdeu a hora) e envio como quem agendou.
  if (source === SCHEDULED_SOURCE) return deliverScheduled(item, now);

  const [row] = await db.select({ deal: deals, contact: contacts, stageKey: stages.key }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, item.dealId));
  if (!row) return cancel("A conversa não existe mais.");
  if (row.deal.archivedAt) return cancel("A conversa foi arquivada.");
  if (row.contact.ignored) return cancel("O contato está marcado como 'não é cliente'.");
  // Fornecedor e Spam (17/10): nunca recebem mensagem automática nem lembrete (o que já estava na fila também não sai).
  if (row.contact.kind === "fornecedor" || row.contact.kind === "spam") return cancel(`O contato está marcado como ${row.contact.kind === "spam" ? "spam" : "fornecedor"}.`);
  // Automáticas pausadas (Fase B): vale no momento de enviar, então o que foi enfileirado ANTES da pausa também não sai. Só a mensagem
  // programada à mão (SCHEDULED_SOURCE, tratada acima) é isenta. Ações internas (etiqueta, nota, passar para, alerta) não passam por aqui.
  const paused = automationBlockReason(row.contact, now);
  if (paused) return cancel(paused);

  if (source === AUTO_REPLY_SOURCE) {
    const [s] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "auto_resposta"));
    if (!(s?.value as { enabled?: boolean } | undefined)?.enabled) return cancel("A resposta fora do horário foi desligada.");
    if (open) return cancel("A Casa já abriu: a resposta fora do horário perdeu o sentido.");
    if (now.getTime() - item.createdAt.getTime() > AUTO_REPLY_MAX_QUEUE_MS) return cancel("A resposta automática ficou mais de 30 minutos na fila.");
    if (!row.deal.awaitingReplySince || row.deal.awaitingReplySince.toISOString() !== meta.awaiting) return cancel("A cliente já foi atendida ou a espera mudou.");
  } else if (source?.startsWith("automacao:")) {
    const [a] = await db.select({ enabled: automations.enabled }).from(automations).where(eq(automations.id, source.slice("automacao:".length)));
    if (!a?.enabled) return cancel("A automação foi desligada.");
  } else if (source?.startsWith(AUTO_MESSAGE_SOURCE)) {
    // Boas-vindas, ausência, encerramento (Lote 4): desligada, velha ou conversa que mudou não sai.
    const why = await autoMessageCancelReason(source, meta, row.deal, item.createdAt, now);
    if (why) return cancel(why);
  } else if (source?.startsWith(WELCOME_SOURCE)) {
    // Menu de boas-vindas (Lote 5), submenu ("menu_boas_vindas:<i>") e resposta da opção ("menu_boas_vindas:resposta"): reconferidos na hora de sair.
    const { getWelcomeMenu } = await import("./welcome-menu");
    if (!(await getWelcomeMenu()).enabled) return cancel("O menu de boas-vindas foi desligado.");
    if (source === WELCOME_SOURCE) {
      if (row.deal.lastOutboundAt) return cancel("Alguém da Casa já respondeu: o menu perdeu o sentido.");
    } else if (source !== WELCOME_REPLY_SOURCE) {
      // Submenu: o menu de cima já saiu (conta como envio), então aqui só conta quem da equipe escreveu depois da escolha (CRM ou celular).
      // A resposta da opção é a continuação do menu: sai mesmo assim.
      const [human] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.dealId, item.dealId), eq(messages.direction, "out"),
        or(isNotNull(messages.sentByUserId), eq(messages.fromPhone, true)), gt(messages.createdAt, item.createdAt))).limit(1);
      if (human) return cancel("Alguém da Casa já respondeu: o menu perdeu o sentido.");
    }
  } else if (source?.startsWith(REMINDER_SOURCE) || source?.startsWith(RESCHEDULED_SOURCE)) {
    // Lote 7B: lembrete do horário e aviso de remarcação. Reconfere ligado, horário ativo, mesmo início e confirmação recente.
    const why = await reminderStillValid(source, now);
    if (why) return cancel(why);
    // 17/10: o texto é refeito agora, com a visita inteira de agora (serviço que entrou ou saiu depois de enfileirar).
    const { reminderTextAtSend } = await import("./client-link/reminder");
    const fresh = await reminderTextAtSend(source, item.text, now);
    if (fresh && fresh !== item.text) { await finish(item.id, { text: fresh }); item = { ...item, text: fresh }; }
  } else if (source?.startsWith(AFTER_VISIT_SOURCE)) {
    // Fase B: Depois do atendimento. Reconfere ligado, visita ainda concluída e o limite de horas; a mensagem é refeita agora
    // (Task 9: no modo `pesquisa` é a enquete de 1 a 5; se o modo mudou depois de enfileirar, sai a do modo de agora, nunca as duas).
    const { afterVisitAtSend } = await import("./after-visit");
    const r = await afterVisitAtSend(source, now, item.id);
    if ("cancel" in r) return cancel(r.cancel);
    const nextValues = r.kind === "poll" ? r.options : [];
    if (r.kind !== item.kind || r.text !== item.text || nextValues.join("\n") !== values.join("\n")) {
      const options: Meta = { ...meta, values: nextValues };
      if (!nextValues.length) delete options.values;
      await finish(item.id, { kind: r.kind, text: r.text, options });
      item = { ...item, kind: r.kind, text: r.text, options };
      values = nextValues;
    }
  } else if (source?.startsWith(SUMMARY_SOURCE)) {
    // Resumo do dia no WhatsApp (Task 11): reconfere ligado na hora de sair.
    const { summaryCancelReason } = await import("./summary-whatsapp");
    const why = await summaryCancelReason();
    if (why) return cancel(why);
  } else if (source?.startsWith(SATISFACTION_HIGH_SOURCE)) {
    // Pesquisa de satisfação (Task 9): a mensagem da nota alta só sai se a nota ainda é alta e a pesquisa continua ligada.
    const { highScoreCancelReason } = await import("./satisfaction");
    const why = await highScoreCancelReason(source);
    if (why) return cancel(why);
  }
  // A enquete da pesquisa por regra ("Mandar a Pesquisa de satisfação") só sai com o Depois do atendimento no modo pesquisa.
  const survey = item.kind === "poll" && isSatisfactionPoll(values);
  if (survey && !source?.startsWith(AFTER_VISIT_SOURCE)) {
    const { getAfterVisit, visitSurveyTaken } = await import("./after-visit");
    if ((await getAfterVisit()).mode !== "pesquisa") return cancel("Ligue a Pesquisa de satisfação em Depois do atendimento.");
    // Uma pesquisa só por visita: a do Depois do atendimento (ou outra regra) já saiu para a mesma visita.
    if (meta.visitId && await visitSurveyTaken(db, meta.visitId, { exceptItemId: item.id, atSend: true })) return cancel(SURVEY_ALREADY);
  }
  // Lembrete/enquete de agendamento: o gatilho ainda precisa valer na hora de enviar.
  if (meta.scheduledAt || meta.stage) {
    if (row.deal.closedAt) return cancel("A conversa foi fechada.");
    if (meta.stage && row.stageKey !== meta.stage) return cancel("A conversa saiu da etapa em que a automação disparou.");
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
      message: alertText.autoSendFailed(clientLabel(row.contact.name, row.contact.phoneE164), "WhatsApp desconectado"), dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
    return cancel(e.message);
  }
  if (channel && await isQuiet(channel.id, now)) return cancel("O WhatsApp está em modo quieto (histórico recém-importado).");

  // Arquivo da Biblioteca apagado (ou sumido do disco) depois de enfileirar: não sai. A função desligada NÃO cancela (segue as regras da fila).
  let payload: Parameters<typeof deliverAutomated>[2] = { kind: item.kind === "poll" ? "poll" : "text", text: item.text, options: values };
  if (item.kind === "media") {
    const [lib] = meta.fileId ? await db.select({ id: libraryFiles.id }).from(libraryFiles).where(and(eq(libraryFiles.id, meta.fileId), isNull(libraryFiles.deletedAt))) : [];
    if (!lib) return cancel("O arquivo saiu da Biblioteca.");
    payload = { kind: "media", fileId: meta.fileId!, caption: meta.caption ?? null };
  }
  const last = item.attempts >= MAX_SEND_ATTEMPTS;
  let delivered;
  try {
    delivered = await deliverAutomated(item.dealId, channel, payload, last,
      (messageId) => { progress.pending = true; return saveMessageId(item, messageId); });
  } catch (e) {
    // Fail-closed: só reenvia o que está EXPLICITAMENTE marcado como "não saiu" (resposta de erro da Evolution ou falha antes de chamar o provider).
    // Sem a linha pendente o provider nem foi chamado (ex.: o banco falhou ao gravá-la): nada saiu, pode tentar de novo.
    if (!(e instanceof SendError)) console.error("[fila] erro inesperado no envio automático", item.id, errDetail(e));
    const notSent = (e instanceof NotSentError) || (e instanceof SendError && !(e instanceof UncertainSendError)) || !progress.pending;
    if (!notSent) { // incerto ou desconhecido: pode ter saído, então NÃO reenvia
      await finish(item.id, { status: "failed", error: e instanceof UncertainSendError ? UNCERTAIN_SEND_MESSAGE : `Erro inesperado no envio: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` });
      await alertInterrupted(item, clientLabel(row.contact.name, row.contact.phoneE164), "não teve resposta confiável da Evolution e pode ter saído");
      return "failed";
    }
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!last) {
      await finish(item.id, { status: "pending", error: msg, notBefore: new Date(now.getTime() + BACKOFF_MIN[item.attempts - 1] * 60_000) });
      return "retry";
    }
    await finish(item.id, { status: "failed", error: msg });
    await db.insert(alerts).values({ dealId: item.dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info",
      message: alertText.autoSendFailed(clientLabel(row.contact.name, row.contact.phoneE164), `${item.attempts} tentativas sem sucesso`),
      dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
    return "failed";
  }
  // A mensagem saiu: nunca mais reenvia. Se o registro no CRM falhou, o erro fica anotado no item.
  await finish(item.id, { status: "sent", sentAt: now, error: delivered.confirmError ? `Enviada, mas o registro no CRM falhou: ${delivered.confirmError}`.slice(0, 300) : null });
  // Pesquisa de satisfação: a enquete saiu, grava a pergunta (quem fez e o que fez). O erro aqui nunca volta o item para a fila.
  // Se falhar, o voto cria a linha (applyPollVote acha a enquete pelo messageId guardado no item): nunca reenvia.
  if (survey && delivered.messageId) {
    try {
      await db.update(outbox).set({ options: sql`jsonb_set(coalesce(${outbox.options}, '{}'::jsonb), '{messageId}', to_jsonb(${delivered.messageId}::text))` }).where(eq(outbox.id, item.id));
      const { recordSatisfactionAsked } = await import("./satisfaction");
      await recordSatisfactionAsked({ messageId: delivered.messageId, dealId: item.dealId, source, visitId: meta.visitId, at: now });
    } catch (e) { console.error("[fila] não gravou a Pesquisa de satisfação", item.id, errDetail(e)); }
  }
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

/** Mensagem do erro com a causa (o drizzle embrulha o erro do Postgres em `cause`). */
const errDetail = (e: unknown) => e instanceof Error ? (e.cause instanceof Error ? `${e.message} — ${e.cause.message}` : e.message) : String(e);

/** Erro inesperado: se a linha pendente já existia, o provider pode ter enviado — "envio incerto"; senão, nada saiu. Nunca reenvia. */
async function alertUnexpected(item: OutboxItem, maybeSent: boolean) {
  const [c] = await db.select({ name: contacts.name, phone: contacts.phoneE164 }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, item.dealId));
  const who = c ? clientLabel(c.name, c.phone) : "a cliente";
  const message = maybeSent
    ? `Mensagem automática para ${who}: envio incerto. Confira no WhatsApp antes de reenviar (erro inesperado depois do envio).`
    : alertText.autoSendFailed(who, "erro antes do envio");
  await db.insert(alerts).values({ dealId: item.dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info", message, dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
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
    await alertInterrupted(it, c ? clientLabel(c.name, c.phone) : "a cliente", "foi interrompido");
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
  const afterWindow = inAfterVisitWindow(now.getTime(), await (await import("./after-visit")).getAfterVisit());
  for (let guard = 0; room > 0 && guard < 500; guard++) {
    const item = await claimNext(now, open, afterWindow);
    if (!item) break;
    let r: Outcome;
    const progress = { pending: false };
    try { r = await processItem(item, now, open, progress); }
    catch (e) { // erro inesperado (banco): não deixa o item "enviando" para sempre, registra e avisa a gestão
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      console.error("[fila] erro inesperado no envio automático", item.id, errDetail(e));
      await finish(item.id, { status: "failed", error: msg }).catch((dbErr) => console.error("[fila] não marcou o item como falho", item.id, dbErr instanceof Error ? dbErr.message : dbErr));
      await alertUnexpected(item, progress.pending).catch((dbErr) => console.error("[fila] não criou o alerta do erro inesperado", item.id, dbErr instanceof Error ? dbErr.message : dbErr));
      r = "failed";
    }
    summary[r]++;
    if (r === "sent") room--;
  }
  return summary;
}
