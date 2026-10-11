import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, messages } from "../db/schema";
import { env } from "../env";
import { whatsapp } from "./evolution";
import { sniffMime } from "../security/sniff";

export const mediaDir = () => env().MEDIA_DIR || path.join(process.cwd(), "data", "media");
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4", "video/webm": "webm", "application/pdf": "pdf" };
const extFor = (mime: string | null) => (mime && EXT[mime.split(";")[0].trim()]) || "bin";
/** Baixado automaticamente; vídeo e documento só quando alguém abre. */
const AUTO_KINDS = ["image", "audio", "sticker"];
const MAX_ATTEMPTS = 3;

/** fileName do documento no nó do WhatsApp (direto ou dentro de documentWithCaptionMessage/ephemeralMessage…). */
function originalFileName(node: unknown, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 4) return null;
  const doc = (node as { documentMessage?: { fileName?: unknown } }).documentMessage;
  if (typeof doc?.fileName === "string" && doc.fileName.trim()) return doc.fileName;
  for (const v of Object.values(node)) {
    const inner = v && typeof v === "object" ? (v as { message?: unknown }).message : null;
    const found = originalFileName(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function save(name: string, data: Buffer) {
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), data);
  return name;
}

/** Garante o arquivo da mídia no disco (baixa pela Evolution se preciso). */
export async function ensureMedia(messageId: string): Promise<{ file: string; mime: string; name: string } | null> {
  const [row] = await db.select({ m: messages, instance: channels.instanceName, chStatus: channels.status }).from(messages)
    .leftJoin(channels, eq(channels.id, messages.channelId)).where(eq(messages.id, messageId));
  if (!row) return null;
  const m = row.m;
  if (m.mediaPurgedAt) return null; // apagada pela retenção: não baixa de novo
  // Nome para o download: o nome original do documento, senão a legenda, senão o do arquivo salvo.
  // A extensão certa (pelo tipo detectado) é garantida em mediaHeaders.
  const nameFor = (saved: string) => (m.kind === "document" && (originalFileName(m.media?.message) || m.body)) || saved;
  if (m.mediaPath) return { file: path.join(mediaDir(), m.mediaPath), mime: m.mediaMime ?? "application/octet-stream", name: nameFor(m.mediaPath) };
  if (!m.media) return null;
  // Canal removido/desconectado: tenta por qualquer número conectado (a chave da mídia é o que importa).
  const instance = row.chStatus === "conectado" ? row.instance
    : (await db.select({ i: channels.instanceName }).from(channels).where(eq(channels.status, "conectado")).limit(1))[0]?.i;
  const p = whatsapp();
  if (!instance || !p.downloadMedia) return null;
  try {
    const r = await p.downloadMedia(instance, m.media);
    const buf = Buffer.from(r.base64, "base64");
    // O tipo vem dos bytes; o mimetype declarado pela Evolution/remetente não é confiável.
    const mime = sniffMime(buf.subarray(0, 256 * 1024)) ?? "application/octet-stream";
    const name = await save(`${m.id}.${extFor(mime)}`, buf);
    await db.update(messages).set({ mediaPath: name, mediaMime: mime }).where(eq(messages.id, m.id));
    return { file: path.join(mediaDir(), name), mime, name: nameFor(name) };
  } catch (e) {
    await db.update(messages).set({ mediaAttempts: sql`${messages.mediaAttempts} + 1` }).where(eq(messages.id, m.id));
    console.error("[mídia] não baixou", m.id, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Worker: baixa fotos, áudios e figurinhas recentes enquanto o link do WhatsApp ainda vale. */
export async function downloadPendingMedia(limit = 20) {
  const rows = await db.select({ id: messages.id }).from(messages)
    .where(and(isNotNull(messages.media), isNull(messages.mediaPath), isNull(messages.mediaPurgedAt), inArray(messages.kind, AUTO_KINDS), lt(messages.mediaAttempts, MAX_ATTEMPTS),
      sql`${messages.createdAt} > now() - interval '30 days'`))
    .orderBy(desc(messages.createdAt)).limit(limit);
  let ok = 0;
  for (const r of rows) if (await ensureMedia(r.id)) ok++;
  return { tried: rows.length, ok };
}

/** Worker: foto de perfil de quem tem lead aberto (revisa a cada 7 dias). */
export async function refreshAvatars(limit = 15) {
  const p = whatsapp();
  const [ch] = await db.select({ i: channels.instanceName }).from(channels).where(eq(channels.status, "conectado")).limit(1);
  if (!ch || !p.profilePictureUrl) return { tried: 0, ok: 0 };
  const rows = await db.selectDistinct({ id: contacts.id, phone: contacts.phoneE164 }).from(contacts)
    .innerJoin(deals, and(eq(deals.contactId, contacts.id), isNull(deals.closedAt), isNull(deals.archivedAt)))
    .where(or(isNull(contacts.avatarCheckedAt), lt(contacts.avatarCheckedAt, new Date(Date.now() - 7 * 86_400_000)))).limit(limit);
  let ok = 0;
  for (const c of rows) {
    let avatarPath: string | null = null;
    try {
      const url = await p.profilePictureUrl(ch.i, c.phone);
      if (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) { avatarPath = await save(`avatar-${c.id}.jpg`, Buffer.from(await res.arrayBuffer())); ok++; }
      }
    } catch (e) { console.error("[avatar]", c.id, e instanceof Error ? e.message : e); }
    await db.update(contacts).set({ avatarCheckedAt: new Date(), ...(avatarPath ? { avatarPath } : {}) }).where(eq(contacts.id, c.id));
  }
  return { tried: rows.length, ok };
}

export async function readMediaFile(file: string) { return readFile(file); }
