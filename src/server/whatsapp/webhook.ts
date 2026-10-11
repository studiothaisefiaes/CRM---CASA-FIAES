import { createHash, timingSafeEqual } from "node:crypto";
import { asc, eq, isNull, and, lt, gt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, messages, outbox, webhookEvents } from "../db/schema";
import { importHistoryChat, recordInbound, recordOutbound, type HistoryMessage, type MediaNode } from "../domain/deals";
import { emit } from "../domain/events";
import { startQuietIfPaired } from "../domain/quiet";
import { applyPollVote } from "../domain/poll-vote";
import { UNCERTAIN_SEND_MESSAGE } from "../domain/send";

export function checkSecret(received: string | null, expected: string) {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Hora da mensagem para gravar em `messages.created_at`. O WhatsApp manda `messageTimestamp` em segundos: duas mensagens no mesmo segundo
 * empatavam (S.000) e a conversa podia mostrá-las trocadas. Usa a hora de chegada (ms), presa dentro do segundo informado pelo WhatsApp:
 * - chegou dentro do próprio segundo (ao vivo): a hora de chegada, que segue a ordem de chegada;
 * - chegou depois (fila da Evolution, reenvio): o fim do segundo (S.999). Se fosse S.000, uma resposta que chega atrasada ficaria "antes"
 *   da mensagem da cliente que chegou ao vivo no mesmo segundo, e não contaria como resposta;
 * - relógio do servidor atrás do WhatsApp: o início do segundo.
 * Nunca sai do segundo do WhatsApp, então prazos e relatórios não mudam.
 */
export function messageTime(timestampSeconds: number | undefined | null, now = Date.now()): Date {
  if (!timestampSeconds) return new Date(now);
  const start = timestampSeconds * 1000;
  return new Date(Math.min(Math.max(now, start), start + 999));
}

type CtxInfo = { externalAdReply?: object; conversionSource?: string; ctwaClid?: string };
type DocMsg = { caption?: string; fileName?: string };
/** Só os campos do Baileys que o CRM usa. */
type LocationMsg = { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string };
type PollMsg = { name?: string };
/** Voto em enquete como a Evolution 2.3.7 entrega (já decifrado): `vote.selectedOptions` traz os NOMES das opções escolhidas. */
type PollUpdateMsg = { pollCreationMessageKey?: { id?: string; remoteJid?: string; fromMe?: boolean }; vote?: { selectedOptions?: unknown[] }; senderTimestampMs?: number };
/** Agregado por opção que a Evolution monta em `data.pollUpdates`: quem votou em cada uma (lista vazia = não escolhida). */
type PollAggregate = { name?: string; voters?: string[] };
type ProtocolMsg = { key?: { id?: string }; type?: number | string; editedMessage?: Record<string, unknown> };
export type BaileysMessage = {
  ptvMessage?: object; liveLocationMessage?: LocationMsg; contactsArrayMessage?: { displayName?: string };
  pollCreationMessage?: PollMsg; pollCreationMessageV2?: PollMsg; pollCreationMessageV3?: PollMsg; eventMessage?: { name?: string };
  buttonsResponseMessage?: { selectedDisplayText?: string }; templateButtonReplyMessage?: { selectedDisplayText?: string };
  listResponseMessage?: { title?: string }; interactiveResponseMessage?: { body?: { text?: string } };
  conversation?: string; extendedTextMessage?: { text?: string; contextInfo?: CtxInfo };
  imageMessage?: { caption?: string }; videoMessage?: { caption?: string }; audioMessage?: object; stickerMessage?: object;
  documentMessage?: DocMsg; documentWithCaptionMessage?: { message?: { documentMessage?: DocMsg } };
  locationMessage?: LocationMsg; contactMessage?: { displayName?: string; vcard?: string };
  reactionMessage?: object; pollUpdateMessage?: PollUpdateMsg; messageContextInfo?: object; protocolMessage?: ProtocolMsg; senderKeyDistributionMessage?: object;
};
type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string; remoteJidAlt?: string; senderPn?: string };
type EvoMessageData = { key?: EvoKey; pushName?: string | null; message?: BaileysMessage | null; messageType?: string; messageTimestamp?: number; contextInfo?: CtxInfo | null; pollUpdates?: PollAggregate[] };
type EvoConnectionData = { remoteJid?: string; fromMe?: boolean; state?: string; statusReason?: number; wuid?: string; keyId?: string; status?: string; senderPn?: string; remoteJidAlt?: string };
export type EvoPayload = { event?: string; instance?: string; data?: (EvoMessageData & EvoConnectionData) | EvoMessageData[]; date_time?: string };

/** Embrulhos do WhatsApp que só carregam outra mensagem dentro (temporária, visualização única, legenda de documento). */
const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"] as const;
type Loose = Record<string, unknown> & BaileysMessage;
function unwrap(m: Loose): Loose {
  for (let i = 0; i < 3; i++) {
    const w = WRAPPERS.find((k) => (m[k] as { message?: Loose } | undefined)?.message);
    if (!w || w === "documentWithCaptionMessage") break;
    m = (m[w] as { message: Loose }).message;
  }
  return m;
}
/** Tipos que não são conversa (sistema, confirmação, reação…): não viram mensagem nem cobram resposta. */
const SILENT = ["reactionMessage", "encReactionMessage", "secretEncryptedMessage", "pollUpdateMessage", "pinInChatMessage", "keepInChatMessage",
  "albumMessage", "senderKeyDistributionMessage", "messageContextInfo", "callLogMesssage", "bcallMessage", "protocolMessage", "editedMessage"];

/** Extrai tipo e texto de uma mensagem do WhatsApp (Baileys). null = não é conversa. */
export function parseContent(raw: BaileysMessage | null | undefined): { kind: string; body: string | null } | null {
  if (!raw) return null;
  const m = unwrap(raw as Loose);
  const keys = Object.keys(m);
  if (keys.length === 0 || keys.every((k) => SILENT.includes(k))) return null;
  if (typeof m.conversation === "string") return { kind: "text", body: m.conversation };
  if (m.extendedTextMessage?.text) return { kind: "text", body: m.extendedTextMessage.text };
  if (m.imageMessage) return { kind: "image", body: m.imageMessage.caption || null };
  if (m.videoMessage) return { kind: "video", body: m.videoMessage.caption || null };
  if (m.ptvMessage) return { kind: "video", body: null }; // vídeo-recado (bolinha)
  if (m.audioMessage) return { kind: "audio", body: null };
  if (m.documentMessage || m.documentWithCaptionMessage) {
    const d = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
    return { kind: "document", body: d?.caption || d?.fileName || null };
  }
  if (m.stickerMessage) return { kind: "sticker", body: null };
  if (m.locationMessage || m.liveLocationMessage) {
    const l = (m.locationMessage ?? m.liveLocationMessage)!;
    const where = [l.name, l.address].filter(Boolean).join(" · ");
    const link = l.degreesLatitude != null ? `https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}` : "";
    return { kind: "location", body: [where, link].filter(Boolean).join(" · ") || "Localização compartilhada" };
  }
  if (m.contactMessage) {
    const tel = m.contactMessage.vcard?.match(/TEL[^:]*:([^\n\r]+)/)?.[1]?.trim();
    return { kind: "contact", body: [m.contactMessage.displayName, tel].filter(Boolean).join(" · ") || "Contato compartilhado" };
  }
  if (m.contactsArrayMessage) return { kind: "contact", body: m.contactsArrayMessage.displayName ?? "Contatos compartilhados" };
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) return { kind: "poll", body: `Enquete: ${poll.name ?? ""}`.trim() };
  if (m.eventMessage) return { kind: "event", body: `Evento: ${m.eventMessage.name ?? ""}`.trim() };
  // Respostas de botão/lista: o que importa é a opção escolhida.
  const choice = m.buttonsResponseMessage?.selectedDisplayText ?? m.templateButtonReplyMessage?.selectedDisplayText ?? m.listResponseMessage?.title
    ?? m.interactiveResponseMessage?.body?.text;
  if (choice) return { kind: "text", body: choice };
  return { kind: "other", body: null };
}

/** Edição ou exclusão de uma mensagem já recebida (o WhatsApp manda como mensagem nova apontando para a original). */
export function protocolAction(raw: BaileysMessage | null | undefined): { type: "edit"; id: string; body: string | null } | { type: "delete"; id: string } | null {
  if (!raw) return null;
  const m = raw as Loose;
  const proto = m.protocolMessage ?? (m.editedMessage as { message?: Loose } | undefined)?.message?.protocolMessage;
  if (!proto?.key?.id) return null;
  const t = proto.type;
  if (t === 0 || t === "REVOKE") return { type: "delete", id: proto.key.id };
  if (t === 14 || t === "MESSAGE_EDIT") return { type: "edit", id: proto.key.id, body: parseContent(proto.editedMessage as BaileysMessage)?.body ?? null };
  return null;
}

const MEDIA_KINDS = new Set(["image", "video", "audio", "sticker", "document"]);
/** Guarda { key, message } da mídia para o worker baixar o arquivo (o link do WhatsApp expira). */
function mediaNode(kind: string, d: EvoMessageData): MediaNode | null {
  return MEDIA_KINDS.has(kind) && d.key && d.message ? { key: d.key as Record<string, unknown>, message: d.message as Record<string, unknown> } : null;
}

const QUOTE_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", audio: "Áudio", sticker: "Figurinha", document: "Documento", location: "Localização", contact: "Contato", poll: "Enquete" };
/** Texto (ou tipo) da mensagem citada quando a pessoa responde uma mensagem específica. */
function quotedBody(d: EvoMessageData): string | null {
  const msg = (d.message ?? {}) as Record<string, { contextInfo?: { quotedMessage?: BaileysMessage } } | undefined>;
  const ci = (d.contextInfo as { quotedMessage?: BaileysMessage } | null | undefined)
    ?? Object.values(msg).find((v) => v && typeof v === "object" && v.contextInfo?.quotedMessage)?.contextInfo;
  const q = parseContent(ci?.quotedMessage);
  if (!q) return null;
  return (q.body ?? QUOTE_LABEL[q.kind] ?? "Mensagem").slice(0, 280);
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

/**
 * Voto de enquete, no formato real da Evolution 2.3.7 (conferido em dist/main.js):
 *  - `messages.upsert` com `data.message.pollUpdateMessage` (enquete em `pollCreationMessageKey.id`; a Evolution troca
 *    `vote.selectedOptions` pelos nomes das opções) e `data.pollUpdates = [{ name, voters }]`;
 *  - `messages.update` com `data.keyId` = id da enquete e `data.pollUpdates` no mesmo formato agregado.
 * `option` é a opção escolhida (null = voto retirado ou não decifrado).
 */
export function pollVoteOf(event: string, d: EvoMessageData & EvoConnectionData | undefined): { pollId: string; option: string | null } | null {
  if (!d) return null;
  const upd = d.message?.pollUpdateMessage;
  const pollId = event === "messages.update" ? (d.pollUpdates ? d.keyId : undefined) : upd?.pollCreationMessageKey?.id;
  if (!pollId) return null;
  const named = (upd?.vote?.selectedOptions ?? []).find((o): o is string => typeof o === "string" && o.trim() !== "");
  const aggregated = (d.pollUpdates ?? []).find((o) => o.name && (o.voters?.length ?? 0) > 0)?.name;
  return { pollId, option: named ?? aggregated ?? null };
}

export async function handleEvolutionEvent(p: EvoPayload) {
  const event = eventName(p.event);
  const channelId = await channelIdFor(p.instance);
  if (event === "messages.set") return { ok: true, queued: true }; // histórico: processado pelo worker (processHistoryEvents)
  if (Array.isArray(p.data)) return { ok: true, ignored: event || "sem_evento" };
  if (event === "connection.update") {
    const state = p.data?.state as string | undefined;
    const status: "conectado" | "aguardando_qr" | "desconectado" = state === "open" ? "conectado" : state === "connecting" ? "aguardando_qr" : "desconectado";
    const phone = typeof p.data?.wuid === "string" ? "+" + p.data.wuid.split("@")[0].split(":")[0] : undefined;
    if (p.instance) {
      const [before] = await db.select().from(channels).where(eq(channels.instanceName, p.instance));
      // "connecting" de um número já pareado é só a Evolution reconectando (rede piscou, Mac acordou): continua conectado.
      if (state === "connecting" && before?.status === "conectado") {
        await db.update(channels).set({ lastEventAt: new Date() }).where(eq(channels.id, before.id));
        return { ok: true, kind: "connection", status: "conectado" as const, reconectando: true };
      }
      await db.update(channels).set({ status, lastEventAt: new Date(), ...(phone && status === "conectado" ? { phone } : {}) })
        .where(eq(channels.instanceName, p.instance));
      // Número recém-pareado (ou outro número lido no canal): o histórico vai chegar, 48 h sem avisos desse canal.
      if (status === "conectado" && before) await startQuietIfPaired(before, phone);
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
    const vote = pollVoteOf(event, p.data as EvoMessageData & EvoConnectionData);
    if (vote) return { ok: true, kind: "poll_vote", result: await applyPollVote({ channelId, pollExternalId: vote.pollId, option: vote.option }) };
    // Status de entrega: SERVER_ACK (enviada), DELIVERY_ACK (entregue), READ / PLAYED (lida), ERROR (falhou).
    const id = p.data?.keyId; const raw = String(p.data?.status ?? "").toUpperCase();
    const status = raw.includes("READ") || raw.includes("PLAYED") ? "read" : raw.includes("DELIVERY") ? "delivered" : raw.includes("ERROR") ? "failed" : raw.includes("SERVER") ? "sent" : null;
    if (id && status) {
      const rank = sql`case ${messages.status} when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end`;
      const next = { sent: 1, delivered: 2, read: 3, failed: 0 }[status];
      // Nunca rebaixa (read > delivered > sent); falha só sobrescreve quem ainda não foi entregue.
      const r = await db.update(messages).set({ status }).where(and(eq(messages.externalId, id), status === "failed" ? sql`${rank} <= 1` : sql`${rank} < ${next}`)).returning({ id: messages.id });
      if (r.length === 0) {
        // O status pode chegar antes da própria mensagem (lote do celular): tenta de novo pelo worker.
        const [exists] = await db.select({ id: messages.id }).from(messages).where(eq(messages.externalId, id)).limit(1);
        if (!exists) throw new RetryLater("status antes da mensagem");
      }
      await emit("status_mensagem", {});
    }
    return { ok: true, kind: "status", status };
  }
  if (event === "messages.upsert" || event === "send.message") {
    const d = p.data as EvoMessageData & EvoConnectionData;
    // Voto na enquete de confirmação: não é conversa (e não precisa do número, só do id da enquete).
    const vote = d?.message?.pollUpdateMessage && !d.key?.fromMe ? pollVoteOf(event, d) : null;
    if (vote) return { ok: true, kind: "poll_vote", result: await applyPollVote({ channelId, pollExternalId: vote.pollId, option: vote.option, at: d.messageTimestamp ? new Date(d.messageTimestamp * 1000) : undefined }) };
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
    const proto = protocolAction(d.message);
    if (proto) {
      const set = proto.type === "edit" ? { editedAt: new Date(), ...(proto.body != null ? { body: proto.body } : {}) } : { deletedAt: new Date() };
      const r = await db.update(messages).set(set).where(eq(messages.externalId, proto.id)).returning({ dealId: messages.dealId });
      if (r[0]?.dealId) await emit("mensagem_atualizada", { dealId: r[0].dealId });
      return { ok: true, kind: proto.type, found: r.length > 0 };
    }
    if (await isSelfChat(p.instance, jid)) return { ok: true, ignored: "conversa_consigo_mesmo" };
    const content = parseContent(d.message);
    if (!content) return { ok: true, ignored: "tipo_ignorado" };
    const at = messageTime(d.messageTimestamp);
    if (d.key.fromMe) {
      // Enviada pelo CRM: o envio já gravou a mensagem como "enviando"; só vincula o id externo.
      if (event === "send.message" && await claimPendingSend(jid, d.key.id, content, channelId)) return { ok: true, kind: "out", claimed: true };
      const r = await recordOutbound({ phoneRaw: jid, channelId, externalId: d.key.id, body: content.body, kind: content.kind,
        fromPhone: event === "messages.upsert", at, media: mediaNode(content.kind, d), quotedBody: quotedBody(d) });
      return { ok: true, kind: "out", result: r };
    }
    const r = await recordInbound({ channelId, externalId: d.key.id, phoneRaw: jid, pushName: d.pushName, kind: content.kind,
      body: content.body, at, hasAdReferral: hasAd(d), media: mediaNode(content.kind, d), quotedBody: quotedBody(d) });
    return { ok: true, kind: "in", result: r };
  }
  return { ok: true, ignored: event || "sem_evento" };
}

const MEDIA_ECHO_KINDS = ["image", "video", "audio", "document", "sticker"];

/**
 * Vincula o id externo à mensagem que o CRM gravou antes de chamar a Evolution (evita duplicar e perder o autor).
 * Texto casa pelo corpo; mídia casa por canal + contato + tipo + "enviando" numa janela curta (a legenda pode faltar ou mudar no eco).
 */
async function claimPendingSend(jid: string, externalId: string, content: { kind: string; body: string | null }, channelId: string | null) {
  const { normalizePhone } = await import("../domain/phone");
  const phone = normalizePhone(jid); if (!phone) return false;
  const media = MEDIA_ECHO_KINDS.includes(content.kind);
  const r = await db.execute(media ? sql`
    update messages m set external_id = ${externalId}, status = 'sent'
    where m.id = (select m2.id from messages m2 join contacts c on c.id = m2.contact_id
      where c.phone_e164 = ${phone} and m2.direction = 'out' and m2.external_id is null and m2.status = 'pending'
        and m2.kind = ${content.kind} and (${channelId}::uuid is null or m2.channel_id = ${channelId}::uuid)
        and m2.created_at > now() - interval '2 minutes'
      order by m2.created_at desc limit 1)
    returning m.id` : sql`
    update messages m set external_id = ${externalId}, status = case when m.status in ('pending','failed') then 'sent' else m.status end,
      error = case when m.status = 'failed' then null else m.error end
    where m.id = (select m2.id from messages m2 join contacts c on c.id = m2.contact_id
      where c.phone_e164 = ${phone} and m2.direction = 'out' and m2.external_id is null
        and m2.body is not distinct from ${content.body}
        and ((m2.status in ('pending','sent') and m2.created_at > now() - interval '5 minutes')
          -- envio automático marcado "incerto" (a Evolution não respondeu) cujo eco chegou depois: a mensagem tinha saído
          or (m2.status = 'failed' and m2.error = ${UNCERTAIN_SEND_MESSAGE} and m2.created_at > now() - interval '15 minutes'
              and (${channelId}::uuid is null or m2.channel_id = ${channelId}::uuid)))
      order by case m2.status when 'pending' then 0 when 'sent' then 1 else 2 end, m2.created_at desc limit 1)
    returning m.id`);
  const claimed = r.rows[0] as { id: string } | undefined;
  if (claimed && !media) await promoteUncertainSend(claimed.id, externalId, channelId);
  return r.rows.length > 0;
}

/**
 * Eco de um envio automático que a fila deu como "incerto": o item do outbox passa a `sent`, o alerta da gestão é resolvido e
 * o envio é registrado como automático (não conta como resposta humana: sem evento `resposta`, `firstResponseAt` nem `awaitingReplySince`).
 * Se a linha não pertence a um item falho da fila, não faz nada.
 */
async function promoteUncertainSend(messageId: string, externalId: string, channelId: string | null) {
  const [item] = await db.update(outbox).set({ status: "sent", sentAt: new Date(), error: null })
    .where(and(sql`${outbox.options}->>'messageId' = ${messageId}`, eq(outbox.status, "failed"))).returning({ id: outbox.id, dealId: outbox.dealId });
  if (!item) return;
  const now = new Date();
  await db.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dedupeKey, `auto:${item.id}`), isNull(alerts.resolvedAt)));
  await recordOutbound({ dealId: item.dealId, channelId, externalId, status: "sent", claimMessageId: messageId, automated: true })
    .catch((e) => console.error("[eco] não registrou o envio promovido", e instanceof Error ? e.message : e));
}

/**
 * Grava o evento cru (dedupe) e processa. Lança erro só se NÃO conseguiu gravar (o webhook responde 5xx e a Evolution reenvia).
 * Se gravou mas o processamento falhou, devolve { queued } e o worker tenta de novo.
 */
export async function ingestEvolution(p: EvoPayload) {
  const one = Array.isArray(p.data) ? undefined : p.data;
  const k = one?.key?.id ?? one?.keyId;
  // Troca de voto na mesma enquete tem o mesmo id e status: o hash do voto evita descartá-la como duplicada.
  const poll = one?.pollUpdates ? `:${createHash("sha1").update(JSON.stringify(one.pollUpdates)).digest("hex").slice(0, 10)}` : "";
  const key = k ? `${p.event}:${p.instance}:${k}:${one?.status ?? ""}${poll}` : `${p.event}:${p.instance}:${p.date_time ?? Date.now()}:${Math.random()}`;
  const [row] = await db.insert(webhookEvents).values({ provider: "evolution", externalId: key, event: p.event ?? "?", payload: p as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!row) return { ok: true, duplicate: true };
  if (eventName(p.event) === "messages.set") return { ok: true, queued: true }; // fica pendente para o worker
  try {
    const r = await handleEvolutionEvent(p);
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, row.id));
    return r;
  } catch (e) {
    if (!(e instanceof RetryLater)) console.error("[webhook] processamento falhou; fica para o worker", e);
    await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e), attempts: 1 }).where(eq(webhookEvents.id, row.id)).catch(() => {});
    return { ok: false, queued: true };
  }
}

export const MAX_ATTEMPTS = 8;
/** Falha esperada e temporária (ex.: status chegou antes da mensagem): tenta de novo sem alarde. */
export class RetryLater extends Error {}
/** No reprocessamento, estado de conexão antigo não vale mais (o vigia de conexão cuida do atual). */
const STALE_ON_RETRY = new Set(["connection.update", "qrcode.updated"]);

/** Worker: reprocessa eventos que falharam nas últimas 24 h, mais antigos primeiro, até 8 tentativas. */
export async function retryFailedWebhooks(limit = 50) {
  const rows = await db.select().from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS), ne(webhookEvents.event, "messages.set"),
      lt(webhookEvents.receivedAt, new Date(Date.now() - 30_000)), gt(webhookEvents.receivedAt, new Date(Date.now() - 86_400_000))))
    .orderBy(asc(webhookEvents.receivedAt)).limit(limit);
  let ok = 0;
  for (const r of rows) {
    if (STALE_ON_RETRY.has(eventName(r.event))) { await db.update(webhookEvents).set({ processedAt: new Date(), error: "estado antigo: ignorado" }).where(eq(webhookEvents.id, r.id)); continue; }
    try { await handleEvolutionEvent(r.payload as EvoPayload); await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, r.id)); ok++; }
    catch (e) {
      const attempts = r.attempts + 1;
      await db.update(webhookEvents).set({ error: e instanceof Error ? e.message : String(e), attempts }).where(eq(webhookEvents.id, r.id));
      if (attempts >= MAX_ATTEMPTS && e instanceof RetryLater) { await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, r.id)); continue; }
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
        list.push({ externalId: d.key.id, fromMe: !!d.key.fromMe, at: new Date(Number(d.messageTimestamp) * 1000), kind: content.kind, body: content.body, pushName: d.pushName, media: mediaNode(content.kind, d), quotedBody: quotedBody(d) });
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

/** Eventos crus já processados só servem para diagnóstico: guarda 14 dias (uma madrugada de reconexão gera milhares). */
export async function purgeOldWebhookEvents(now = new Date()) {
  await db.delete(webhookEvents).where(and(sql`${webhookEvents.processedAt} is not null`, lt(webhookEvents.receivedAt, new Date(now.getTime() - 14 * 86_400_000))));
}
