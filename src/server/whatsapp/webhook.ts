import { createHash, timingSafeEqual } from "node:crypto";
import { asc, eq, isNull, and, lt, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, messages, webhookEvents } from "../db/schema";
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
type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string; remoteJidAlt?: string; senderPn?: string };
type EvoMessageData = { key?: EvoKey; pushName?: string | null; message?: BaileysMessage | null; messageType?: string; messageTimestamp?: number; contextInfo?: CtxInfo | null };
type EvoConnectionData = { state?: string; wuid?: string; keyId?: string; status?: string; senderPn?: string; remoteJidAlt?: string };
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
      const [before] = await db.select().from(channels).where(eq(channels.instanceName, p.instance));
      await db.update(channels).set({ status, lastEventAt: new Date(), ...(phone && status === "conectado" ? { phone } : {}) })
        .where(eq(channels.instanceName, p.instance));
      // Falha silenciosa nº 1: número que estava conectado e caiu → avisa a gestão na hora.
      if (before?.status === "conectado" && status === "desconectado") {
        await db.insert(alerts).values({
          audience: "gestao", type: "whatsapp_desconectado", severity: "urgente",
          message: `O WhatsApp "${before.name}" desconectou. Leia o QR code de novo em Configurações › WhatsApp.`,
          dedupeKey: `desconectado:${before.id}:${new Date().toISOString().slice(0, 16)}`,
        }).onConflictDoNothing();
      }
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
  if (event === "messages.update") {
    // Status de entrega: SERVER_ACK (enviada), DELIVERY_ACK (entregue), READ / PLAYED (lida), ERROR (falhou).
    const id = p.data?.keyId; const raw = String(p.data?.status ?? "").toUpperCase();
    const status = raw.includes("READ") || raw.includes("PLAYED") ? "read" : raw.includes("DELIVERY") ? "delivered" : raw.includes("ERROR") ? "failed" : raw.includes("SERVER") ? "sent" : null;
    if (id && status) {
      const rank = sql`case ${messages.status} when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end`;
      const next = { sent: 1, delivered: 2, read: 3, failed: 0 }[status];
      // Nunca rebaixa (read > delivered > sent); falha só sobrescreve quem ainda não foi entregue.
      await db.update(messages).set({ status }).where(and(eq(messages.externalId, id), status === "failed" ? sql`${rank} <= 1` : sql`${rank} < ${next}`));
      await emit("status_mensagem", {});
    }
    return { ok: true, kind: "status", status };
  }
  if (event === "messages.upsert" || event === "send.message") {
    const d = p.data as EvoMessageData;
    let jid = d?.key?.remoteJid;
    // Contatos com identificador anônimo (@lid): o número real vem em remoteJidAlt/senderPn.
    if (jid?.endsWith("@lid")) jid = d.key?.remoteJidAlt ?? d.key?.senderPn ?? p.data?.senderPn ?? jid;
    if (jid?.endsWith("@lid")) {
      await db.insert(alerts).values({
        audience: "gestao", type: "mensagem_sem_numero", severity: "info",
        message: `Chegou mensagem de "${d.pushName ?? "contato"}" sem número visível (WhatsApp com ID anônimo). Confira no celular.`,
        dedupeKey: `lid:${jid}`,
      }).onConflictDoNothing();
      return { ok: true, ignored: "lid_sem_numero" };
    }
    if (!jid || !d.key?.id) return { ok: true, ignored: "sem_chave" };
    const content = parseContent(d.message);
    if (!content) return { ok: true, ignored: "tipo_ignorado" };
    const at = d.messageTimestamp ? new Date(d.messageTimestamp * 1000) : new Date();
    if (d.key.fromMe) {
      // Enviada pelo CRM: o envio já gravou a mensagem como "enviando"; só vincula o id externo.
      if (event === "send.message" && await claimPendingSend(jid, d.key.id, content.body)) return { ok: true, kind: "out", claimed: true };
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

/** Vincula o id externo à mensagem que o CRM gravou antes de chamar a Evolution (evita duplicar e perder o autor). */
async function claimPendingSend(jid: string, externalId: string, body: string | null) {
  const { normalizePhone } = await import("../domain/phone");
  const phone = normalizePhone(jid); if (!phone) return false;
  const r = await db.execute(sql`
    update messages m set external_id = ${externalId}, status = case when m.status = 'pending' then 'sent' else m.status end
    where m.id = (select m2.id from messages m2 join contacts c on c.id = m2.contact_id
      where c.phone_e164 = ${phone} and m2.direction = 'out' and m2.external_id is null and m2.status in ('pending','sent')
        and m2.body is not distinct from ${body} and m2.created_at > now() - interval '5 minutes'
      order by m2.created_at desc limit 1)
    returning m.id`);
  return r.rows.length > 0;
}

/**
 * Grava o evento cru (dedupe) e processa. Lança erro só se NÃO conseguiu gravar (o webhook responde 5xx e a Evolution reenvia).
 * Se gravou mas o processamento falhou, devolve { queued } e o worker tenta de novo.
 */
export async function ingestEvolution(p: EvoPayload) {
  const k = p.data?.key?.id ?? p.data?.keyId;
  const key = k ? `${p.event}:${p.instance}:${k}:${p.data?.status ?? ""}` : `${p.event}:${p.instance}:${p.date_time ?? Date.now()}:${Math.random()}`;
  const [row] = await db.insert(webhookEvents).values({ provider: "evolution", externalId: key, event: p.event ?? "?", payload: p as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!row) return { ok: true, duplicate: true };
  try {
    const r = await handleEvolutionEvent(p);
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, row.id));
    return r;
  } catch (e) {
    console.error("[webhook] processamento falhou; fica para o worker", e);
    await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e), attempts: 1 }).where(eq(webhookEvents.id, row.id)).catch(() => {});
    return { ok: false, queued: true };
  }
}

export const MAX_ATTEMPTS = 8;

/** Worker: reprocessa eventos que falharam nas últimas 24 h, mais antigos primeiro, até 8 tentativas. */
export async function retryFailedWebhooks(limit = 50) {
  const rows = await db.select().from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS),
      lt(webhookEvents.receivedAt, new Date(Date.now() - 30_000)), gt(webhookEvents.receivedAt, new Date(Date.now() - 86_400_000))))
    .orderBy(asc(webhookEvents.receivedAt)).limit(limit);
  let ok = 0;
  for (const r of rows) {
    try { await handleEvolutionEvent(r.payload as EvoPayload); await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, r.id)); ok++; }
    catch (e) {
      const attempts = r.attempts + 1;
      await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e), attempts }).where(eq(webhookEvents.id, r.id));
      if (attempts >= MAX_ATTEMPTS) await db.insert(alerts).values({ audience: "gestao", type: "webhook_falhou", severity: "info",
        message: `Uma mensagem do WhatsApp não pôde ser registrada depois de ${attempts} tentativas. Erro: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`,
        dedupeKey: `webhook:${r.id}` }).onConflictDoNothing();
    }
  }
  return { tried: rows.length, ok };
}
