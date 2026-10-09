import { createHash, timingSafeEqual } from "node:crypto";
import { asc, eq, isNull, and, lt, gt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, messages, webhookEvents } from "../db/schema";
import { importHistoryChat, recordInbound, recordOutbound, type HistoryMessage } from "../domain/deals";
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
export type EvoPayload = { event?: string; instance?: string; data?: (EvoMessageData & EvoConnectionData) | EvoMessageData[]; date_time?: string };

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

async function channelFor(instance?: string) {
  if (!instance) return null;
  const [c] = await db.select({ id: channels.id, phone: channels.phone }).from(channels).where(eq(channels.instanceName, instance));
  return c ?? null;
}
async function channelIdFor(instance?: string) { return (await channelFor(instance))?.id ?? null; }

/** Conversa do número com ele mesmo (anotações no WhatsApp): não é cliente. */
async function isSelfChat(instance: string | undefined, jid: string) {
  const ch = await channelFor(instance);
  const { normalizePhone } = await import("../domain/phone");
  return !!ch?.phone && normalizePhone(jid) === normalizePhone(ch.phone); // a Evolution informa o número sem o 9
}

/** Processa um evento já autenticado. Idempotente por natureza (mensagens têm id externo único). */
const eventName = (e?: string) => (e ?? "").toLowerCase().replace(/_/g, ".");

/** Número real de uma conversa individual; null para grupo, status, canal ou @lid sem número. */
function chatPhone(key?: EvoKey, senderPn?: string): string | null {
  let jid = key?.remoteJid;
  if (jid?.endsWith("@lid")) jid = key?.remoteJidAlt ?? key?.senderPn ?? senderPn ?? jid;
  return jid?.endsWith("@s.whatsapp.net") ? jid : null;
}

export async function handleEvolutionEvent(p: EvoPayload) {
  const event = eventName(p.event);
  const channelId = await channelIdFor(p.instance);
  if (event === "messages.set") return { ok: true, queued: true }; // histórico: processado pelo worker (processHistoryEvents)
  if (Array.isArray(p.data)) return { ok: true, ignored: event || "sem_evento" };
  if (event === "connection.update") {
    const state = p.data?.state as string | undefined;
    const status = state === "open" ? "conectado" : state === "connecting" ? "aguardando_qr" : "desconectado";
    const phone = typeof p.data?.wuid === "string" ? "+" + p.data.wuid.split("@")[0].split(":")[0] : undefined;
    if (p.instance) {
      const [before] = await db.select().from(channels).where(eq(channels.instanceName, p.instance));
      await db.update(channels).set({ status, lastEventAt: new Date(), ...(phone && status === "conectado" ? { phone } : {}) })
        .where(eq(channels.instanceName, p.instance));
      // Mesmo número lido em outro canal: os leads abertos do canal antigo (desconectado) passam a responder por este.
      if (status === "conectado" && phone && before) {
        await db.execute(sql`update deals set channel_id = ${before.id}
          where closed_at is null and channel_id in (select id from channels where phone = ${phone} and id <> ${before.id} and status <> 'conectado')`);
      }
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
    const d = p.data as EvoMessageData & EvoConnectionData;
    let jid = d?.key?.remoteJid;
    // Contatos com identificador anônimo (@lid): o número real vem em remoteJidAlt/senderPn.
    if (jid?.endsWith("@lid")) jid = d.key?.remoteJidAlt ?? d.key?.senderPn ?? d.senderPn ?? jid;
    if (jid?.endsWith("@lid")) {
      await db.insert(alerts).values({
        audience: "gestao", type: "mensagem_sem_numero", severity: "info",
        message: `Chegou mensagem de "${d.pushName ?? "contato"}" sem número visível (WhatsApp com ID anônimo). Confira no celular.`,
        dedupeKey: `lid:${jid}`,
      }).onConflictDoNothing();
      return { ok: true, ignored: "lid_sem_numero" };
    }
    if (!jid || !d.key?.id) return { ok: true, ignored: "sem_chave" };
    if (await isSelfChat(p.instance, jid)) return { ok: true, ignored: "conversa_consigo_mesmo" };
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
  const one = Array.isArray(p.data) ? undefined : p.data;
  const k = one?.key?.id ?? one?.keyId;
  const key = k ? `${p.event}:${p.instance}:${k}:${one?.status ?? ""}` : `${p.event}:${p.instance}:${p.date_time ?? Date.now()}:${Math.random()}`;
  const [row] = await db.insert(webhookEvents).values({ provider: "evolution", externalId: key, event: p.event ?? "?", payload: p as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!row) return { ok: true, duplicate: true };
  if (eventName(p.event) === "messages.set") return { ok: true, queued: true }; // fica pendente para o worker
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
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS), ne(webhookEvents.event, "messages.set"),
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

/**
 * Histórico que o WhatsApp manda ao conectar o número (evento messages.set, lotes de até ~5 mil mensagens).
 * Roda no worker, fora da requisição do webhook. Cada conversa individual vira lead ou contato com histórico.
 */
export async function processHistoryEvents(limit = 20) {
  const rows = await db.select().from(webhookEvents)
    .where(and(eq(webhookEvents.event, "messages.set"), isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(webhookEvents.receivedAt)).limit(limit);
  let chats = 0, leads = 0;
  for (const r of rows) {
    const p = r.payload as EvoPayload;
    try {
      const channelId = await channelIdFor(p.instance);
      const byChat = new Map<string, HistoryMessage[]>();
      for (const d of Array.isArray(p.data) ? p.data : []) {
        const jid = chatPhone(d.key);
        const content = parseContent(d.message);
        if (!jid || !d.key?.id || !content || !d.messageTimestamp) continue;
        const list = byChat.get(jid) ?? [];
        list.push({ externalId: d.key.id, fromMe: !!d.key.fromMe, at: new Date(Number(d.messageTimestamp) * 1000), kind: content.kind, body: content.body, pushName: d.pushName });
        byChat.set(jid, list);
      }
      for (const [jid, items] of byChat) {
        if (await isSelfChat(p.instance, jid)) continue;
        const res = await importHistoryChat(channelId, jid, items);
        chats++; if ("created" in res && res.created) leads++;
      }
      await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, r.id));
    } catch (e) {
      console.error("[histórico] lote falhou", e);
      await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e), attempts: r.attempts + 1 }).where(eq(webhookEvents.id, r.id));
    }
  }
  if (chats) await emit("historico_importado", { chats, leads });
  return { lotes: rows.length, chats, leads };
}
