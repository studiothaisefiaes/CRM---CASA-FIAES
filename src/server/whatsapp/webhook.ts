import { createHash, timingSafeEqual } from "node:crypto";
import { eq, isNull, and, lt } from "drizzle-orm";
import { db } from "../db";
import { channels, webhookEvents } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals";
import { emit } from "../domain/events";

export function checkSecret(received: string | null, expected: string) {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type CtxInfo = { externalAdReply?: object; conversionSource?: string; ctwaClid?: string };
type DocMsg = { caption?: string; fileName?: string };
/** Só os campos do Baileys que o CRM usa. */
export type BaileysMessage = {
  conversation?: string; extendedTextMessage?: { text?: string; contextInfo?: CtxInfo };
  imageMessage?: { caption?: string }; videoMessage?: { caption?: string }; audioMessage?: object; stickerMessage?: object;
  documentMessage?: DocMsg; documentWithCaptionMessage?: { message?: { documentMessage?: DocMsg } };
  locationMessage?: object; contactMessage?: { displayName?: string };
  reactionMessage?: object; protocolMessage?: object; senderKeyDistributionMessage?: object;
};
type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string; remoteJidAlt?: string };
type EvoMessageData = { key?: EvoKey; pushName?: string | null; message?: BaileysMessage | null; messageType?: string; messageTimestamp?: number; contextInfo?: CtxInfo | null };
type EvoConnectionData = { state?: string; wuid?: string };
export type EvoPayload = { event?: string; instance?: string; data?: EvoMessageData & EvoConnectionData; date_time?: string };

/** Extrai tipo e texto de uma mensagem do WhatsApp (Baileys). */
export function parseContent(m: BaileysMessage | null | undefined): { kind: string; body: string | null } | null {
  if (!m) return null;
  if (m.reactionMessage || m.protocolMessage || (m.senderKeyDistributionMessage && Object.keys(m).length === 1)) return null;
  if (typeof m.conversation === "string") return { kind: "text", body: m.conversation };
  if (m.extendedTextMessage?.text) return { kind: "text", body: m.extendedTextMessage.text };
  if (m.imageMessage) return { kind: "image", body: m.imageMessage.caption ?? null };
  if (m.videoMessage) return { kind: "video", body: m.videoMessage.caption ?? null };
  if (m.audioMessage) return { kind: "audio", body: null };
  if (m.documentMessage || m.documentWithCaptionMessage) {
    const d = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
    return { kind: "document", body: d?.caption ?? d?.fileName ?? null };
  }
  if (m.stickerMessage) return { kind: "sticker", body: null };
  if (m.locationMessage) return { kind: "location", body: "Localização compartilhada" };
  if (m.contactMessage) return { kind: "contact", body: m.contactMessage.displayName ?? "Contato compartilhado" };
  return { kind: "other", body: null };
}

function hasAd(d: EvoMessageData) {
  const ci = d.contextInfo ?? d.message?.extendedTextMessage?.contextInfo;
  return !!(ci?.externalAdReply || ci?.conversionSource || ci?.ctwaClid);
}

async function channelIdFor(instance?: string) {
  if (!instance) return null;
  const [c] = await db.select({ id: channels.id }).from(channels).where(eq(channels.instanceName, instance));
  return c?.id ?? null;
}

/** Processa um evento já autenticado. Idempotente por natureza (mensagens têm id externo único). */
export async function handleEvolutionEvent(p: EvoPayload) {
  const event = (p.event ?? "").toLowerCase().replace(/_/g, ".");
  const channelId = await channelIdFor(p.instance);
  if (event === "connection.update") {
    const state = p.data?.state as string | undefined;
    const status = state === "open" ? "conectado" : state === "connecting" ? "aguardando_qr" : "desconectado";
    const phone = typeof p.data?.wuid === "string" ? "+" + p.data.wuid.split("@")[0].split(":")[0] : undefined;
    if (p.instance) {
      await db.update(channels).set({ status, lastEventAt: new Date(), ...(phone && status === "conectado" ? { phone } : {}) })
        .where(eq(channels.instanceName, p.instance));
      await emit("canal_atualizado", { instance: p.instance, status });
    }
    return { ok: true, kind: "connection", status };
  }
  if (event === "qrcode.updated") {
    if (p.instance) {
      await db.update(channels).set({ status: "aguardando_qr", lastQrAt: new Date() }).where(eq(channels.instanceName, p.instance));
      await emit("canal_atualizado", { instance: p.instance, status: "aguardando_qr" });
    }
    return { ok: true, kind: "qrcode" };
  }
  if (event === "messages.upsert" || event === "send.message") {
    const d = p.data as EvoMessageData;
    const jid = d?.key?.remoteJid;
    if (!jid || !d.key?.id) return { ok: true, ignored: "sem_chave" };
    const content = parseContent(d.message);
    if (!content) return { ok: true, ignored: "tipo_ignorado" };
    const at = d.messageTimestamp ? new Date(d.messageTimestamp * 1000) : new Date();
    if (d.key.fromMe) {
      const r = await recordOutbound({ phoneRaw: jid, channelId, externalId: d.key.id, body: content.body, kind: content.kind,
        fromPhone: event === "messages.upsert", at });
      return { ok: true, kind: "out", result: r };
    }
    const r = await recordInbound({ channelId, externalId: d.key.id, phoneRaw: jid, pushName: d.pushName, kind: content.kind,
      body: content.body, at, hasAdReferral: hasAd(d) });
    return { ok: true, kind: "in", result: r };
  }
  return { ok: true, ignored: event || "sem_evento" };
}

/** Grava o evento cru (dedupe) e processa. Se falhar, fica marcado para o worker tentar de novo. */
export async function ingestEvolution(p: EvoPayload) {
  const key = p.data?.key?.id ? `${p.event}:${p.instance}:${p.data.key.id}` : `${p.event}:${p.instance}:${p.date_time ?? Date.now()}:${Math.random()}`;
  const [row] = await db.insert(webhookEvents).values({ provider: "evolution", externalId: key, event: p.event ?? "?", payload: p as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!row) return { ok: true, duplicate: true };
  try {
    const r = await handleEvolutionEvent(p);
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, row.id));
    return r;
  } catch (e) {
    await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e) }).where(eq(webhookEvents.id, row.id));
    throw e;
  }
}

/** Worker: reprocessa eventos que falharam (até 1 dia). */
export async function retryFailedWebhooks(limit = 50) {
  const rows = await db.select().from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.receivedAt, new Date(Date.now() - 30_000)))).limit(limit);
  let ok = 0;
  for (const r of rows) {
    try { await handleEvolutionEvent(r.payload as EvoPayload); await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, r.id)); ok++; }
    catch (e) { await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e) }).where(eq(webhookEvents.id, r.id)); }
  }
  return { tried: rows.length, ok };
}
