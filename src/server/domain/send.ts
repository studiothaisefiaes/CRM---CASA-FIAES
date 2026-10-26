import { randomUUID } from "node:crypto";
import { isHiddenNumber } from "@/lib/phone-client";
import path from "node:path";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, dealEvents, deals, messages, users } from "../db/schema";
import { signBody, defaultSignature } from "@/lib/signature";
import { whatsapp } from "../whatsapp/evolution";
import { ProviderError, type QuotedMessage } from "../whatsapp/provider";
import { save as saveMediaFile } from "../whatsapp/media";
import { sniffMime, type SafeMime } from "../security/sniff";
import { recordOutbound } from "./deals";
import { emit, logEvent } from "./events";
import { env } from "../env";

export class SendError extends Error {}
import { UNCERTAIN_SEND_MESSAGE } from "@/lib/send-status";
export { UNCERTAIN_SEND_MESSAGE };
/** O provider não respondeu (timeout, rede, resposta ilegível): a mensagem PODE ter saído. Nunca reenviar sozinho. */
export class UncertainSendError extends SendError {
  /** `message`: o arquivo mantém o recado de sempre ("Não foi possível enviar: …"); o que importa para quem chama é a classe (não repetir). */
  constructor(message: string = UNCERTAIN_SEND_MESSAGE) { super(message); }
}
/** A Evolution respondeu com erro explícito de que NÃO enviou (4xx/5xx, exceto 408/502/503/504): é o único caso com retry. */
export class NotSentError extends SendError {}
/** Status em que a resposta pode ter vindo de um proxy/timeout e a mensagem ainda ter saído. */
const AMBIGUOUS_STATUS = new Set([408, 502, 503, 504]);
const isNotSent = (e: unknown) => e instanceof ProviderError && e.status !== undefined && e.status >= 400 && e.status <= 599 && !AMBIGUOUS_STATUS.has(e.status);

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
/** Limite de legenda de foto/vídeo do WhatsApp (com a assinatura junto, quando vai assinada). */
export const WHATSAPP_CAPTION_MAX = 1024;
type Channel = typeof channels.$inferSelect;
type Target = { deal: typeof deals.$inferSelect; phone: string };

async function loadTarget(dealId: string): Promise<Target> {
  const [row] = await db.select({ deal: deals, phone: contacts.phoneE164 }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) throw new SendError("Conversa não encontrada.");
  // Número oculto (@lid): os dígitos do @lid não são telefone. Até o envio para @lid ser testado, responde-se pelo celular.
  if (isHiddenNumber(row.phone)) throw new SendError("Essa cliente está com o número oculto no WhatsApp. Responda pelo celular do salão por enquanto; a conversa continua aparecendo aqui.");
  return row;
}

/** Responde sempre pelo mesmo número em que a cliente escreveu; null só quando não há nenhum conectado (e DEV_TOOLS simula). */
export async function resolveChannel(dealId: string, deal: Target["deal"]): Promise<Channel | null> {
  let channel = deal.channelId ? (await db.select().from(channels).where(eq(channels.id, deal.channelId)))[0] : undefined;
  if (channel && channel.status !== "conectado") {
    // O mesmo número pode ter sido lido de novo em outro canal: responde por ele e o lead passa a usar esse canal.
    const same = channel.phone ? (await db.select().from(channels).where(and(eq(channels.phone, channel.phone), eq(channels.status, "conectado"))).limit(1))[0] : undefined;
    if (!same) throw new SendError(`O WhatsApp "${channel.name}" está desconectado. Leia o QR code de novo em Configurações › WhatsApp.`);
    channel = same;
    await db.update(deals).set({ channelId: same.id }).where(eq(deals.id, dealId));
  }
  if (!channel) channel = (await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1))[0];
  if (!channel) {
    if (env().DEV_TOOLS) return null;
    throw new SendError("Nenhum WhatsApp conectado. Conecte um número em Configurações › WhatsApp.");
  }
  return channel;
}

const QUOTE_LABEL: Record<string, string> = { image: "📷 Foto", video: "🎥 Vídeo", audio: "🎤 Áudio", document: "📄 Documento", sticker: "Figurinha" };

/**
 * Mensagem do mesmo lead que está sendo respondida (citação).
 * Sem id externo (ex.: mensagem simulada) a citação não pode ir ao WhatsApp, então devolve null:
 * o CRM não grava nem mostra uma citação que não foi enviada.
 */
async function loadQuote(dealId: string, quoteMessageId?: string | null): Promise<QuotedMessage | null> {
  if (!quoteMessageId) return null;
  const [q] = await db.select().from(messages).where(and(eq(messages.id, quoteMessageId), eq(messages.dealId, dealId)));
  if (!q) throw new SendError("A mensagem que você quer responder não está mais nesta conversa.");
  if (!q.externalId) return null;
  return { externalId: q.externalId, fromMe: q.direction === "out", text: (q.body?.trim() || QUOTE_LABEL[q.kind] || "Mensagem").slice(0, 300) };
}

/** A assinatura da pessoa logada vai na primeira linha, como no ChatGuru (as clientes já conhecem). Sem assinatura cadastrada, o 1º nome em maiúsculas. */
export async function signAs(userId: string, text: string): Promise<string> {
  const [me] = await db.select({ signature: users.signature, name: users.name }).from(users).where(eq(users.id, userId));
  return signBody(me?.signature || defaultSignature(me?.name), text);
}

/**
 * Envia texto pelo WhatsApp a partir do card.
 * 1) grava a mensagem como "enviando" (com quem enviou), 2) chama a Evolution, 3) confirma e registra como resposta.
 * Se falhar, a mensagem fica marcada como "falhou" na conversa e o lead continua esperando resposta.
 * `quoteMessageId`: responde citando essa mensagem da conversa.
 */
export async function sendFromCrm(dealId: string, text: string, userId: string, opts: { quoteMessageId?: string | null } = {}) {
  const typed = text.trim();
  if (!typed) throw new SendError("Escreva uma mensagem antes de enviar.");
  if (typed.length > 4000) throw new SendError("Mensagem muito longa (máximo 4.000 caracteres).");
  const body = await signAs(userId, typed);
  const row = await loadTarget(dealId);
  const quote = await loadQuote(dealId, opts.quoteMessageId);
  const channel = await resolveChannel(dealId, row.deal);
  if (!channel) return recordOutbound({ dealId, channelId: null, body, userId, status: "simulado", quotedBody: quote?.text ?? null });

  const [pending] = await db.insert(messages).values({
    dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: "text", body, status: "pending", sentByUserId: userId, sentVia: "crm", quotedBody: quote?.text ?? null,
  }).returning({ id: messages.id });
  await emit("mensagem_enviando", { dealId });

  let externalId: string | null = null;
  try {
    ({ externalId } = await whatsapp().sendText(channel.instanceName, row.phone, body, quote ?? undefined));
  } catch (e) {
    // Timeout/rede: pode ter saído. O aviso pede para conferir no WhatsApp antes de reenviar (a cliente recebia duas vezes).
    const uncertain = !isNotSent(e);
    const msg = uncertain ? UNCERTAIN_SEND_MESSAGE : e instanceof Error ? e.message : "erro desconhecido";
    // Só vira "falhou" se ainda estiver pendente: se o eco do WhatsApp chegou antes, a mensagem foi entregue.
    const failed = await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) })
      .where(and(eq(messages.id, pending.id), eq(messages.status, "pending"))).returning({ id: messages.id });
    const echoed = failed.length === 0 ? await claimedByEcho(pending.id) : null;
    if (!echoed) {
      await emit("mensagem_falhou", { dealId });
      throw uncertain ? new UncertainSendError() : new SendError(`Não foi possível enviar: ${msg}`);
    }
    externalId = echoed.externalId;
  }
  const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body, userId });
  // Respondeu: agora sim a cliente vê o visto azul (abrir sem responder só manda visto quando é a dona).
  // Sem esperar: é outra ida à Evolution e não pode segurar a resposta do envio (o balão e o campo ficam presos até a ação voltar).
  void markConversationRead(dealId, userId, { replying: true });
  return res;
}

/**
 * Localização ou cartão de contato a partir do CRM (Task 12): mesmo caminho do texto (linha pendente, provider, confirmSent).
 * `body` é o mesmo texto que o eco do WhatsApp gera (parseContent), para o eco casar e não duplicar.
 * Provider sem a função: recusa ANTES de gravar qualquer coisa.
 */
export async function sendToolFromCrm(dealId: string, userId: string, spec: {
  kind: "location" | "contact"; body: string; need: "sendLocation" | "sendContact"; label: string;
  send: (p: ReturnType<typeof whatsapp>, instance: string, phone: string) => Promise<{ externalId: string | null }>;
}) {
  const row = await loadTarget(dealId);
  const channel = await resolveChannel(dealId, row.deal);
  const p = whatsapp();
  if (channel && !p[spec.need]) throw new SendError(`Este WhatsApp ainda não envia ${spec.label} pelo CRM.`);
  if (!channel) return recordOutbound({ dealId, channelId: null, body: spec.body, kind: spec.kind, userId, status: "simulado" });
  const [pending] = await db.insert(messages).values({
    dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: spec.kind, body: spec.body, status: "pending", sentByUserId: userId, sentVia: "crm",
  }).returning({ id: messages.id });
  await emit("mensagem_enviando", { dealId });
  let externalId: string | null = null;
  try {
    ({ externalId } = await spec.send(p, channel.instanceName, row.phone));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(messages.id, pending.id));
    await emit("mensagem_falhou", { dealId });
    throw new SendError(`Não foi possível enviar: ${msg}`);
  }
  const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body: spec.body, userId });
  void markConversationRead(dealId, userId, { replying: true });
  return res;
}

export type Upload = { name: string; mime: string; data: Buffer };
type MediaPlan = { kind: "image" | "video" | "audio" | "document"; mime: string; ext: string };

/** O tipo vem dos bytes; o mimetype declarado só desempata mp4/webm de áudio (gravações do navegador). */
export function planMedia(file: Upload): MediaPlan | null {
  const sniffed: SafeMime | null = sniffMime(file.data.subarray(0, 256 * 1024));
  if (!sniffed) return null;
  const declaredAudio = file.mime.toLowerCase().startsWith("audio/");
  switch (sniffed) {
    case "image/jpeg": return { kind: "image", mime: sniffed, ext: "jpg" };
    case "image/png": return { kind: "image", mime: sniffed, ext: "png" };
    case "image/webp": return { kind: "image", mime: sniffed, ext: "webp" };
    case "image/gif": return { kind: "image", mime: sniffed, ext: "gif" };
    case "application/pdf": return { kind: "document", mime: sniffed, ext: "pdf" };
    case "audio/ogg": return { kind: "audio", mime: sniffed, ext: "ogg" };
    case "audio/mpeg": return { kind: "audio", mime: sniffed, ext: "mp3" };
    case "audio/mp4": return { kind: "audio", mime: sniffed, ext: "m4a" };
    case "video/mp4": return declaredAudio ? { kind: "audio", mime: "audio/mp4", ext: "m4a" } : { kind: "video", mime: sniffed, ext: "mp4" };
    case "video/webm": return declaredAudio ? { kind: "audio", mime: "audio/webm", ext: "webm" } : null;
  }
}

const cleanName = (name: string) => Array.from(path.basename(name).replace(/[\u0000-\u001f\u007f"\\]/g, "").trim()).slice(0, 120).join("") || "arquivo";

/**
 * Envia foto, PDF, vídeo ou áudio (gravação) a partir do card. O arquivo enviado fica guardado em MEDIA_DIR para aparecer na conversa.
 * Aceita até 16 MB e só tipos reconhecidos pelos bytes; áudio vai como mensagem de voz.
 * `sign`: a legenda vai assinada como o texto do CRM (resposta pronta com foto/vídeo: o texto dela vira a legenda, 24/10); o limite passa a ser
 * o do WhatsApp (1024) contando a assinatura. `storedPath`: o arquivo JÁ está em MEDIA_DIR (resposta pronta, Biblioteca) e a mensagem aponta
 * para ele, sem gravar uma cópia por envio (quem guarda esse arquivo garante que a retenção e a troca do anexo não o apaguem).
 */
export async function sendMediaFromCrm(dealId: string, file: Upload, caption: string | null, userId: string, opts: { quoteMessageId?: string | null; sign?: boolean; storedPath?: string } = {}) {
  if (!file.data.length) throw new SendError("O arquivo está vazio.");
  if (file.data.length > MAX_MEDIA_BYTES) throw new SendError("O arquivo passa de 16 MB. Escolha um menor.");
  const plan = planMedia(file);
  if (!plan) throw new SendError("Esse tipo de arquivo não pode ser enviado. Use foto, PDF ou áudio.");
  const typed = caption?.trim() || null;
  if (typed && plan.kind === "audio") throw new SendError("Áudio não aceita legenda. Envie o texto em outra mensagem.");
  const text = typed && opts.sign ? await signAs(userId, typed) : typed;
  if (text && opts.sign && text.length > WHATSAPP_CAPTION_MAX) throw new SendError(`Legenda muito longa (máximo ${WHATSAPP_CAPTION_MAX.toLocaleString("pt-BR")} caracteres com a assinatura).`);
  if (text && !opts.sign && text.length > 1000) throw new SendError("Legenda muito longa (máximo 1.000 caracteres).");
  const name = cleanName(file.name);
  const row = await loadTarget(dealId);
  const quote = await loadQuote(dealId, opts.quoteMessageId);
  const channel = await resolveChannel(dealId, row.deal);
  const p = whatsapp();
  if (channel && (plan.kind === "audio" ? !p.sendAudio : !p.sendMedia)) throw new SendError("Este WhatsApp ainda não envia arquivos.");

  // Documento mostra a legenda ou o nome do arquivo; foto/vídeo/áudio mostram a legenda (se houver).
  const body = plan.kind === "document" ? text ?? name : text;
  const id = randomUUID();
  const mediaPath = opts.storedPath ?? await saveMediaFile(`${id}.${plan.ext}`, file.data);
  const [pending] = await db.insert(messages).values({
    id, dealId, contactId: row.deal.contactId, channelId: channel?.id ?? null, direction: "out", kind: plan.kind, body, status: "pending", sentByUserId: userId, sentVia: "crm",
    mediaPath, mediaMime: plan.mime, quotedBody: quote?.text ?? null,
    // Áudio da Casa também ganha .m4a, duração e transcrição no worker.
    ...(plan.kind === "audio" ? { transcriptStatus: "pendente" as const } : {}),
    // Nome original do arquivo no mesmo formato do nó do WhatsApp: o download usa este nome (a legenda vai em `body`).
    ...(plan.kind === "document" ? { media: { key: {}, message: { documentMessage: { fileName: name } } } } : {}),
  }).returning({ id: messages.id });

  if (!channel) return recordOutbound({ dealId, channelId: null, userId, status: "simulado", claimMessageId: pending.id });
  await emit("mensagem_enviando", { dealId });
  let externalId: string | null = null;
  try {
    ({ externalId } = plan.kind === "audio"
      ? await p.sendAudio!(channel.instanceName, row.phone, file.data, quote ?? undefined)
      : await p.sendMedia!(channel.instanceName, row.phone, { name, mime: plan.mime, data: file.data, mediatype: plan.kind }, text, quote ?? undefined));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(messages.id, pending.id));
    await emit("mensagem_falhou", { dealId });
    // Timeout/rede: o arquivo pode ter saído. Mesmo recado de antes, mas a classe avisa quem envia em série (encaminhar várias) para parar.
    throw isNotSent(e) ? new SendError(`Não foi possível enviar: ${msg}`) : new UncertainSendError(`Não foi possível enviar: ${msg}`);
  }
  const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, userId });
  void markConversationRead(dealId, userId, { replying: true }); // sem esperar (ver sendFromCrm)
  return res;
}

/** Só para testes: roda entre a conferência do eco e a confirmação, para provocar a corrida de forma determinística. */
export const sendHooks: { beforeConfirm?: () => Promise<void> } = {};

const isExternalIdConflict = (e: unknown) => {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  return (err?.code ?? err?.cause?.code) === "23505" && ((err?.constraint ?? err?.cause?.constraint) ?? "messages_external_uq") === "messages_external_uq";
};

/**
 * Confirma o envio. Se o eco do WhatsApp criar a linha entre a conferência e a confirmação (violação de `messages_external_uq`),
 * funde de novo e conclui sem erro: a mensagem já foi entregue.
 */
async function confirmSent(pendingId: string, input: { dealId: string; channelId: string; externalId: string | null; body?: string; userId: string | null; automated?: boolean }) {
  const confirm = (claimMessageId: string) => recordOutbound({ ...input, status: "sent", claimMessageId });
  const claim = await absorbEcho(pendingId, input.channelId, input.externalId);
  await sendHooks.beforeConfirm?.();
  try {
    return await confirm(claim);
  } catch (e) {
    if (claim !== pendingId || !isExternalIdConflict(e)) throw e;
    const again = await absorbEcho(pendingId, input.channelId, input.externalId);
    if (again === pendingId) throw e;
    return confirm(again);
  }
}

/**
 * Se o eco do WhatsApp (SEND_MESSAGE) já criou uma linha com este id externo antes de o envio voltar,
 * a linha pendente é fundida nela (arquivo e autor passam para a do eco) e apagada: nada de duplicata nem erro para a atendente.
 * Devolve a linha que deve ser confirmada.
 */
async function absorbEcho(pendingId: string, channelId: string, externalId: string | null): Promise<string> {
  if (!externalId) return pendingId;
  const [echo] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.externalId, externalId), sql`${messages.id} <> ${pendingId}`));
  if (!echo) return pendingId;
  const [p] = await db.select().from(messages).where(eq(messages.id, pendingId));
  await db.transaction(async (tx) => {
    await tx.update(messages).set({
      mediaPath: p.mediaPath, mediaMime: p.mediaMime, sentByUserId: p.sentByUserId, sentVia: p.sentVia, quotedBody: p.quotedBody,
      body: p.body, status: "sent", ...(p.media ? { media: p.media } : {}),
      transcriptStatus: p.transcriptStatus, transcript: p.transcript, playbackPath: p.playbackPath, mediaDurationSec: p.mediaDurationSec,
    }).where(eq(messages.id, echo.id));
    await tx.delete(messages).where(eq(messages.id, pendingId));
  });
  return echo.id;
}

/**
 * Visto azul: marca como lidas, no WhatsApp, as mensagens recebidas desde a última vez que a conversa foi aberta.
 * Só quando quem abre é a dona da conversa, ou quando alguém responde (`replying`): a gestão espiando não avisa a cliente que foi lida.
 * O ponto de leitura fica no evento `lido`. Nunca lança: se a Evolution estiver fora do ar, tenta de novo na próxima abertura.
 */
export async function markConversationRead(dealId: string, userId: string, opts: { replying?: boolean } = {}): Promise<void> {
  try {
    const p = whatsapp();
    if (!p.markRead) return;
    const row = await loadTarget(dealId);
    if (!opts.replying && row.deal.ownerId !== userId) return;
    let channel = row.deal.channelId ? (await db.select().from(channels).where(eq(channels.id, row.deal.channelId)))[0] : undefined;
    if (channel && channel.status !== "conectado") {
      channel = channel.phone ? (await db.select().from(channels).where(and(eq(channels.phone, channel.phone), eq(channels.status, "conectado"))).limit(1))[0] : undefined;
    }
    if (!channel) return;
    const [last] = await db.select({ lastMessageId: sql<string | null>`${dealEvents.payload}->>'lastMessageId'` }).from(dealEvents)
      .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "lido"))).orderBy(desc(dealEvents.createdAt)).limit(1);
    const unread = await db.select({ id: messages.id, externalId: messages.externalId }).from(messages)
      .where(and(eq(messages.dealId, dealId), eq(messages.direction, "in"), isNotNull(messages.externalId), isNull(messages.deletedAt),
        last?.lastMessageId ? gt(messages.createdAt, sql`(select created_at from messages where id = ${last.lastMessageId})`) : undefined))
      .orderBy(desc(messages.createdAt)).limit(30);
    if (!unread.length) return;
    await p.markRead(channel.instanceName, row.phone, unread.map((m) => m.externalId!).reverse());
    await logEvent(db, dealId, "lido", { lastMessageId: unread[0].id, count: unread.length }, userId);
  } catch (e) {
    console.error("[lido] não marcou como lida", dealId, e instanceof Error ? e.message : e);
  }
}

export type AutomatedPayload = { kind: "text" | "poll"; text: string; options: string[] } | { kind: "media"; fileId: string; caption: string | null };
/**
 * `confirmError`: o provider JÁ enviou, mas o registro no CRM falhou. Nunca reenviar; só anotar o erro.
 * `messageId`: a linha da mensagem na conversa (a Pesquisa de satisfação guarda a da enquete).
 */
export type DeliverResult = { confirmError?: string; messageId?: string };

/**
 * Entrega UMA mensagem automática já conferida pela fila (`drainOutbox`). Mesmo caminho dos envios do CRM:
 * grava como pendente (sem autor: aparece como "automática"), chama o provider e confirma, fundindo o eco do WhatsApp.
 * Sem canal (só com DEV_TOOLS) a mensagem fica como "simulada".
 * Só o erro do PROVIDER é lançado. Com resposta HTTP explícita da Evolution (4xx/5xx) a mensagem não saiu: `keepFailed`
 * decide se a linha pendente vira "falhou" na conversa ou é apagada para tentar de novo. Sem resposta HTTP (timeout, rede)
 * ela pode ter saído: lança `UncertainSendError`, a linha vira "falhou" e a fila NÃO reenvia.
 * `onPending` recebe o id da linha pendente assim que ela é criada (a fila guarda no item). Depois que o provider respondeu, o envio conta como feito: falha ao confirmar
 * volta em `confirmError`, para a fila não reenviar.
 */
export async function deliverAutomated(dealId: string, channel: Channel | null, p: AutomatedPayload, keepFailed: boolean, onPending?: (messageId: string) => Promise<void>): Promise<DeliverResult> {
  const row = await loadTarget(dealId);
  // Arquivo da Biblioteca: o item da fila já conferiu que existe; se sumiu agora, nada saiu (pode tentar de novo / a fila cancela).
  const lib = p.kind === "media" ? await (await import("./library")).readLibraryFile(p.fileId) : null;
  if (p.kind === "media" && !lib) throw new NotSentError("O arquivo saiu da Biblioteca.");
  const mediaKind = lib ? (lib.kind as "image" | "video" | "document" | "audio") : null;
  const caption = p.kind === "media" && mediaKind !== "audio" ? p.caption?.trim() || null : null;
  // Mesma regra do envio da atendente: documento mostra a legenda ou o nome; foto/vídeo, a legenda; áudio, nada.
  const body = p.kind === "poll" ? `Enquete: ${p.text}` : p.kind === "media" ? (mediaKind === "document" ? caption ?? lib!.fileName : caption) : p.text; // igual ao que o eco do WhatsApp traz (parseContent)
  const kind = p.kind === "media" ? mediaKind! : p.kind;
  const mediaCols = lib ? { mediaPath: lib.path, mediaMime: lib.mime, ...(mediaKind === "document" ? { media: { key: {}, message: { documentMessage: { fileName: lib.fileName } } } } : {}) } : {};
  if (!channel) {
    try {
      if (lib) {
        const [m] = await db.insert(messages).values({ dealId, contactId: row.deal.contactId, channelId: null, direction: "out", kind, body, status: "pending", ...mediaCols }).returning({ id: messages.id });
        await recordOutbound({ dealId, channelId: null, status: "simulado", automated: true, claimMessageId: m.id });
        return { messageId: m.id };
      }
      const r = await recordOutbound({ dealId, channelId: null, body: body ?? undefined, kind, status: "simulado", automated: true });
      return "messageId" in r ? { messageId: r.messageId } : {};
    }
    catch (e) { return { confirmError: errMsg(e) }; }
  }
  const prov = whatsapp();
  if (p.kind === "poll" && !prov.sendPoll) throw new SendError("Este WhatsApp ainda não envia enquetes.");
  if (p.kind === "media" && (mediaKind === "audio" ? !prov.sendAudio : !prov.sendMedia)) throw new SendError("Este WhatsApp ainda não envia arquivos.");
  const [pending] = await db.insert(messages).values({ dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind, body, status: "pending", ...mediaCols }).returning({ id: messages.id });
  await onPending?.(pending.id).catch((e) => console.error("[fila] não guardou o id da mensagem pendente", e instanceof Error ? e.message : e));
  type Echoed = { externalId: string | null } | null;
  // O eco chegou antes da resposta de erro: entregue. Registra como qualquer envio automático (sem contar como resposta humana).
  const recordEchoed = async (echoed: NonNullable<Echoed>): Promise<DeliverResult> => {
    await recordOutbound({ dealId, channelId: channel.id, externalId: echoed.externalId, body: body ?? undefined, kind, status: "sent", claimMessageId: pending.id, automated: true }).catch(() => {});
    return { messageId: pending.id };
  };
  let externalId: string | null = null;
  try {
    ({ externalId } = p.kind === "poll"
      ? await prov.sendPoll!(channel.instanceName, row.phone, p.text, p.options)
      : p.kind === "media"
        ? (mediaKind === "audio" ? await prov.sendAudio!(channel.instanceName, row.phone, lib!.data)
          : await prov.sendMedia!(channel.instanceName, row.phone, { name: lib!.fileName, mime: lib!.mime, data: lib!.data, mediatype: mediaKind as "image" | "video" | "document" }, caption))
        : await prov.sendText(channel.instanceName, row.phone, p.text));
  } catch (e) {
    if (!isNotSent(e)) {
      // Pode ter saído (timeout, rede, 408/502/503/504, erro desconhecido). Fail-closed: nunca reenviar.
      // Só vira "falhou" se ainda estiver pendente: se o eco do WhatsApp chegou antes, a mensagem foi entregue.
      let echoed: Echoed = null;
      try {
        const done = await db.update(messages).set({ status: "failed", error: UNCERTAIN_SEND_MESSAGE }).where(and(eq(messages.id, pending.id), eq(messages.status, "pending"))).returning({ id: messages.id });
        if (done.length === 0) echoed = await claimedByEcho(pending.id);
      } catch (dbErr) {
        console.error("[fila] não marcou a mensagem como incerta", pending.id, errMsg(dbErr)); // o item falha do mesmo jeito
      }
      if (echoed) return recordEchoed(echoed);
      throw new UncertainSendError();
    }
    // Só mexe na linha se ela ainda estiver pendente: a Evolution 2.x responde 400 para erros que acontecem DEPOIS do envio,
    // e o eco do WhatsApp pode já ter reivindicado a linha como "sent". Nesse caso ela foi entregue e NÃO pode voltar para a fila.
    const stillPending = and(eq(messages.id, pending.id), eq(messages.status, "pending"));
    const changed = keepFailed
      ? await db.update(messages).set({ status: "failed", error: errMsg(e).slice(0, 300) }).where(stillPending).returning({ id: messages.id })
      : await db.delete(messages).where(stillPending).returning({ id: messages.id });
    const echoed = changed.length === 0 ? await claimedByEcho(pending.id) : null;
    if (echoed) return recordEchoed(echoed);
    throw e instanceof SendError ? e : new NotSentError(errMsg(e));
  }
  try {
    const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body: body ?? undefined, userId: null, automated: true });
    return { messageId: "messageId" in res ? res.messageId : pending.id }; // o eco pode ter ficado com outra linha
  } catch (e) {
    // Já foi enviada: deixa a linha como enviada (o eco do WhatsApp ainda pode casar pelo id) e devolve o erro.
    await db.update(messages).set({ status: "sent", ...(externalId ? { externalId } : {}) }).where(and(eq(messages.id, pending.id), eq(messages.status, "pending"))).catch(() => {});
    return { confirmError: errMsg(e), messageId: pending.id };
  }
}
/** A linha pendente já foi reivindicada pelo eco do WhatsApp (SEND_MESSAGE)? Então a mensagem saiu. */
async function claimedByEcho(messageId: string): Promise<{ externalId: string | null } | null> {
  const [cur] = await db.select({ status: messages.status, externalId: messages.externalId }).from(messages).where(eq(messages.id, messageId));
  return cur?.status === "sent" ? { externalId: cur.externalId } : null;
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
