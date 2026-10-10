import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, dealEvents, deals, messages } from "../db/schema";
import { whatsapp } from "../whatsapp/evolution";
import type { QuotedMessage } from "../whatsapp/provider";
import { save as saveMediaFile } from "../whatsapp/media";
import { sniffMime, type SafeMime } from "../security/sniff";
import { recordOutbound } from "./deals";
import { emit, logEvent } from "./events";
import { env } from "../env";

export class SendError extends Error {}

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
type Channel = typeof channels.$inferSelect;
type Target = { deal: typeof deals.$inferSelect; phone: string };

async function loadTarget(dealId: string): Promise<Target> {
  const [row] = await db.select({ deal: deals, phone: contacts.phoneE164 }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) throw new SendError("Lead não encontrado.");
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

/**
 * Envia texto pelo WhatsApp a partir do card.
 * 1) grava a mensagem como "enviando" (com quem enviou), 2) chama a Evolution, 3) confirma e registra como resposta.
 * Se falhar, a mensagem fica marcada como "falhou" na conversa e o lead continua esperando resposta.
 * `quoteMessageId`: responde citando essa mensagem da conversa.
 */
export async function sendFromCrm(dealId: string, text: string, userId: string, opts: { quoteMessageId?: string | null } = {}) {
  const body = text.trim();
  if (!body) throw new SendError("Escreva uma mensagem antes de enviar.");
  if (body.length > 4000) throw new SendError("Mensagem muito longa (máximo 4.000 caracteres).");
  const row = await loadTarget(dealId);
  const quote = await loadQuote(dealId, opts.quoteMessageId);
  const channel = await resolveChannel(dealId, row.deal);
  if (!channel) return recordOutbound({ dealId, channelId: null, body, userId, status: "simulado", quotedBody: quote?.text ?? null });

  const [pending] = await db.insert(messages).values({
    dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: "text", body, status: "pending", sentByUserId: userId, quotedBody: quote?.text ?? null,
  }).returning({ id: messages.id });
  await emit("mensagem_enviando", { dealId });

  let externalId: string | null = null;
  try {
    ({ externalId } = await whatsapp().sendText(channel.instanceName, row.phone, body, quote ?? undefined));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(messages.id, pending.id));
    await emit("mensagem_falhou", { dealId });
    throw new SendError(`Não foi possível enviar: ${msg}`);
  }
  return confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body, userId });
}

type Upload = { name: string; mime: string; data: Buffer };
type MediaPlan = { kind: "image" | "video" | "audio" | "document"; mime: string; ext: string };

/** O tipo vem dos bytes; o mimetype declarado só desempata mp4/webm de áudio (gravações do navegador). */
function planMedia(file: Upload): MediaPlan | null {
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
 */
export async function sendMediaFromCrm(dealId: string, file: Upload, caption: string | null, userId: string, opts: { quoteMessageId?: string | null } = {}) {
  if (!file.data.length) throw new SendError("O arquivo está vazio.");
  if (file.data.length > MAX_MEDIA_BYTES) throw new SendError("O arquivo passa de 16 MB. Escolha um menor.");
  const plan = planMedia(file);
  if (!plan) throw new SendError("Esse tipo de arquivo não pode ser enviado. Use foto, PDF ou áudio.");
  const text = caption?.trim() || null;
  if (text && plan.kind === "audio") throw new SendError("Áudio não aceita legenda. Envie o texto em outra mensagem.");
  if (text && text.length > 1000) throw new SendError("Legenda muito longa (máximo 1.000 caracteres).");
  const name = cleanName(file.name);
  const row = await loadTarget(dealId);
  const quote = await loadQuote(dealId, opts.quoteMessageId);
  const channel = await resolveChannel(dealId, row.deal);
  const p = whatsapp();
  if (channel && (plan.kind === "audio" ? !p.sendAudio : !p.sendMedia)) throw new SendError("Este WhatsApp ainda não envia arquivos.");

  // Documento mostra a legenda ou o nome do arquivo; foto/vídeo/áudio mostram a legenda (se houver).
  const body = plan.kind === "document" ? text ?? name : text;
  const id = randomUUID();
  const mediaPath = await saveMediaFile(`${id}.${plan.ext}`, file.data);
  const [pending] = await db.insert(messages).values({
    id, dealId, contactId: row.deal.contactId, channelId: channel?.id ?? null, direction: "out", kind: plan.kind, body, status: "pending", sentByUserId: userId,
    mediaPath, mediaMime: plan.mime, quotedBody: quote?.text ?? null,
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
    throw new SendError(`Não foi possível enviar: ${msg}`);
  }
  return confirmSent(pending.id, { dealId, channelId: channel.id, externalId, userId });
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
      mediaPath: p.mediaPath, mediaMime: p.mediaMime, sentByUserId: p.sentByUserId, quotedBody: p.quotedBody,
      body: p.body, status: "sent", ...(p.media ? { media: p.media } : {}),
    }).where(eq(messages.id, echo.id));
    await tx.delete(messages).where(eq(messages.id, pendingId));
  });
  return echo.id;
}

/**
 * Visto azul: marca como lidas, no WhatsApp, as mensagens recebidas desde a última vez que a conversa foi aberta.
 * O ponto de leitura fica no evento `lido`. Nunca lança: se a Evolution estiver fora do ar, tenta de novo na próxima abertura.
 */
export async function markConversationRead(dealId: string, userId: string): Promise<void> {
  try {
    const p = whatsapp();
    if (!p.markRead) return;
    const row = await loadTarget(dealId);
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

export type AutomatedPayload = { kind: "text" | "poll"; text: string; options: string[] };
/** `confirmError`: o provider JÁ enviou, mas o registro no CRM falhou. Nunca reenviar; só anotar o erro. */
export type DeliverResult = { confirmError?: string };

/**
 * Entrega UMA mensagem automática já conferida pela fila (`drainOutbox`). Mesmo caminho dos envios do CRM:
 * grava como pendente (sem autor: aparece como "automática"), chama o provider e confirma, fundindo o eco do WhatsApp.
 * Sem canal (só com DEV_TOOLS) a mensagem fica como "simulada".
 * Só o erro do PROVIDER é lançado (a mensagem não saiu; `keepFailed` decide se a linha pendente vira "falhou" na conversa
 * ou é apagada para tentar de novo). Depois que o provider respondeu, o envio conta como feito: falha ao confirmar
 * volta em `confirmError`, para a fila não reenviar.
 */
export async function deliverAutomated(dealId: string, channel: Channel | null, p: AutomatedPayload, keepFailed: boolean): Promise<DeliverResult> {
  const row = await loadTarget(dealId);
  const body = p.kind === "poll" ? `Enquete: ${p.text}` : p.text; // igual ao que o eco do WhatsApp traz (parseContent)
  if (!channel) {
    try { await recordOutbound({ dealId, channelId: null, body, kind: p.kind, status: "simulado", automated: true }); return {}; }
    catch (e) { return { confirmError: errMsg(e) }; }
  }
  const prov = whatsapp();
  if (p.kind === "poll" && !prov.sendPoll) throw new SendError("Este WhatsApp ainda não envia enquetes.");
  const [pending] = await db.insert(messages).values({ dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: p.kind, body, status: "pending" }).returning({ id: messages.id });
  let externalId: string | null = null;
  try {
    ({ externalId } = p.kind === "poll"
      ? await prov.sendPoll!(channel.instanceName, row.phone, p.text, p.options)
      : await prov.sendText(channel.instanceName, row.phone, p.text));
  } catch (e) {
    if (keepFailed) await db.update(messages).set({ status: "failed", error: errMsg(e).slice(0, 300) }).where(eq(messages.id, pending.id));
    else await db.delete(messages).where(eq(messages.id, pending.id));
    throw e;
  }
  try {
    await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body, userId: null, automated: true });
    return {};
  } catch (e) {
    // Já foi enviada: deixa a linha como enviada (o eco do WhatsApp ainda pode casar pelo id) e devolve o erro.
    await db.update(messages).set({ status: "sent", ...(externalId ? { externalId } : {}) }).where(and(eq(messages.id, pending.id), eq(messages.status, "pending"))).catch(() => {});
    return { confirmError: errMsg(e) };
  }
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
