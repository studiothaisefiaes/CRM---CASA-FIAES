import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, messages } from "../db/schema";
import { save } from "../whatsapp/media";
import { sniffMime } from "../security/sniff";
import { normalizePhone } from "./phone";
import { UserFacingError } from "./errors";
import { exportTitle, looksLikePhone, parseWhatsappExport, readExportFile, type ExportMessage } from "./whatsapp-export";

/**
 * Trazer o histórico antigo pelo "Exportar conversa" do WhatsApp. O arquivo sobe uma vez (prévia), fica numa pasta temporária do servidor
 * só até a importação (ou 2 horas) e é apagado depois. Grava as mensagens na conversa da cliente sem lead (`deal_id` nulo), com
 * `imported_at`: nada de aviso, prazo, não lida, automação ou envio. Não duplica: mesma direção + mesmo texto + até 2 min de diferença,
 * e a chave da linha (`import_key`) segura a reimportação do mesmo arquivo.
 */
export const ZAP_MAX_BYTES = 50 * 1024 * 1024;
/** Mídias do .zip: até 25 MB por importação (foto, áudio, PDF). O que passar disso entra só como texto "(mídia não importada)". */
export const ZAP_MEDIA_BUDGET = 25 * 1024 * 1024;
export const ZAP_MAX_MESSAGES = 50_000;
const DEDUPE_MS = 2 * 60_000;
const KEEP_MS = 2 * 60 * 60_000;
const MEDIA_MIME_OK = (m: string | null): m is string => !!m && (m.startsWith("image/") || m.startsWith("audio/") || m === "application/pdf");

const tmpRoot = () => path.join(tmpdir(), "casa-fiaes-importar-zap");
const tokenOk = (t: string) => /^[a-f0-9]{32}$/.test(t);

/** Guarda o arquivo enviado até a importação. Limpa os esquecidos (mais de 2 h). */
export async function stashUpload(userId: string, fileName: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length > ZAP_MAX_BYTES) throw new UserFacingError("O arquivo passa de 50 MB. Exporte sem mídia ou envie só o .txt.");
  const dir = tmpRoot();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, f);
    if (Date.now() - (await stat(p).then((s) => s.mtimeMs, () => 0)) > KEEP_MS) await rm(p, { force: true });
  }
  const token = randomBytes(16).toString("hex");
  await writeFile(path.join(dir, `${token}.bin`), bytes, { mode: 0o600 });
  await writeFile(path.join(dir, `${token}.json`), JSON.stringify({ userId, fileName: fileName.slice(0, 200) }), { mode: 0o600 });
  return token;
}
async function loadUpload(token: string, userId: string) {
  if (!tokenOk(token)) throw new UserFacingError("A prévia expirou. Envie o arquivo de novo.");
  const dir = tmpRoot();
  const meta = await readFile(path.join(dir, `${token}.json`), "utf8").then((s) => JSON.parse(s) as { userId: string; fileName: string }, () => null);
  if (!meta || meta.userId !== userId) throw new UserFacingError("A prévia expirou. Envie o arquivo de novo.");
  return { fileName: meta.fileName, bytes: new Uint8Array(await readFile(path.join(dir, `${token}.bin`))) };
}
export async function discardUpload(token: string) {
  if (!tokenOk(token)) return;
  await Promise.all([".bin", ".json"].map((e) => rm(path.join(tmpRoot(), `${token}${e}`), { force: true })));
}

export const normText = (s: string | null | undefined) => (s ?? "").normalize("NFC").replace(/[‎‏]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type ZapParticipant = { name: string; count: number };
export type ZapContact = { id: string; name: string | null; phone: string; source: "ficha" | "arquivo" | "nome" | "escolhida" };
export type ZapPreview = {
  token: string; fileName: string; participants: ZapParticipant[];
  /** Quem é a Casa (nome do participante; "" = nenhum, só a cliente escreveu). */ casa: string;
  contact: ZapContact | null; from: string | null; to: string | null; total: number; newCount: number; existingCount: number;
  media: { files: number; imported: number; skipped: number }; ignored: { system: number; deleted: number };
};
export type ZapReport = { contactId: string; inserted: number; existing: number; media: number; mediaSkipped: number; from: string | null; to: string | null };

type Opts = { casa?: string | null; contactId?: string | null };
type Planned = { m: ExportMessage; dir: "in" | "out"; key: string; dup: boolean };

const CASA_NAME = /casa\s*fia[eé]s|fia[eé]s/i;

async function findContact(fileName: string, clientName: string | null, contactId: string | null | undefined, fixed: boolean): Promise<ZapContact | null> {
  const pick = async (where: ReturnType<typeof eq>, source: ZapContact["source"]) => {
    const rows = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(where).limit(2);
    return rows.length === 1 ? { ...rows[0], source } : null;
  };
  if (contactId) {
    const c = await pick(eq(contacts.id, contactId), fixed ? "ficha" : "escolhida");
    if (!c) throw new UserFacingError("Cliente não encontrada.");
    return c;
  }
  const title = exportTitle(fileName);
  const phone = title.phone ?? (clientName && looksLikePhone(clientName) ? normalizePhone(clientName) : null);
  if (phone) { const c = await pick(eq(contacts.phoneE164, phone), "arquivo"); if (c) return c; }
  for (const n of [clientName, title.label].filter((x): x is string => !!x && !looksLikePhone(x))) {
    const c = await pick(sql`lower(trim(${contacts.name})) = ${n.trim().toLowerCase()}` as unknown as ReturnType<typeof eq>, "nome");
    if (c) return c;
  }
  return null;
}

async function analyze(token: string, userId: string, opts: Opts & { fixedContactId?: string | null }) {
  const { fileName, bytes } = await loadUpload(token, userId);
  const file = await readExportFile(fileName, bytes);
  const parsed = parseWhatsappExport(file.chat);
  if (parsed.group) throw new UserFacingError("Esta é uma conversa de grupo. Só dá para trazer conversa com uma cliente.");
  if (!parsed.messages.length) throw new UserFacingError("Não achamos mensagens neste arquivo. Confira se é o \"Exportar conversa\" do WhatsApp.");
  if (parsed.messages.length > ZAP_MAX_MESSAGES) throw new UserFacingError(`A conversa tem mais de ${ZAP_MAX_MESSAGES.toLocaleString("pt-BR")} mensagens.`);
  const participants = parsed.senders.map((name) => ({ name, count: parsed.messages.filter((m) => m.sender === name).length }));
  const casa = opts.casa != null && (opts.casa === "" || parsed.senders.includes(opts.casa)) ? opts.casa
    : parsed.senders.find((s) => CASA_NAME.test(s))
      ?? (parsed.senders.length === 2 ? parsed.senders.find((s) => s !== exportTitle(fileName).label && !(looksLikePhone(s) && normalizePhone(s) === exportTitle(fileName).phone)) ?? parsed.senders[0] : "");
  const clientName = parsed.senders.find((s) => s !== casa) ?? null;
  const contact = await findContact(fileName, clientName, opts.fixedContactId ?? opts.contactId, !!opts.fixedContactId);

  // Chave da linha: direção + minuto + texto + ordem dos iguais (duas "ok" no mesmo minuto são duas mensagens).
  const seen = new Map<string, number>();
  const plan: Planned[] = parsed.messages.map((m) => {
    const dir = m.sender === casa ? "out" as const : "in" as const;
    const base = `${dir}|${Math.floor(m.at.getTime() / 60_000)}|${m.media?.kind ?? "text"}|${normText(m.text)}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { m, dir, key: createHash("sha1").update(`${base}|${n}`).digest("hex"), dup: false };
  });

  if (contact) {
    const first = plan[0].m.at.getTime(), last = plan[plan.length - 1].m.at.getTime();
    const keys = new Set((await db.select({ k: messages.importKey }).from(messages)
      .where(and(eq(messages.contactId, contact.id), isNotNull(messages.importKey), inArray(messages.importKey, plan.map((p) => p.key))))).map((r) => r.k));
    // Mensagens que já estão na conversa (recebidas pelo CRM ou importadas antes de outro arquivo): cada uma casa com uma linha só.
    const existing = await db.select({ id: messages.id, dir: messages.direction, body: messages.body, at: messages.createdAt, key: messages.importKey }).from(messages)
      .where(and(eq(messages.contactId, contact.id), gte(messages.createdAt, new Date(Math.min(first, last) - DEDUPE_MS)), lte(messages.createdAt, new Date(Math.max(first, last) + DEDUPE_MS))));
    const pool = new Map<string, { at: number; used: boolean }[]>();
    for (const e of existing) {
      if (e.key && keys.has(e.key)) continue; // já casa pela chave
      const k = `${e.dir}|${normText(e.body)}`;
      pool.set(k, [...(pool.get(k) ?? []), { at: e.at.getTime(), used: false }]);
    }
    for (const p of plan) {
      if (keys.has(p.key)) { p.dup = true; continue; }
      const cands = pool.get(`${p.dir}|${normText(p.m.text)}`);
      const hit = cands?.filter((c) => !c.used && Math.abs(c.at - p.m.at.getTime()) <= DEDUPE_MS).sort((a, b) => Math.abs(a.at - p.m.at.getTime()) - Math.abs(b.at - p.m.at.getTime()))[0];
      if (hit) { hit.used = true; p.dup = true; }
    }
  }

  // Quais mídias do .zip cabem (só foto, áudio e PDF; na ordem da conversa, até o limite).
  let budget = ZAP_MEDIA_BUDGET;
  const mediaOk = new Set<Planned>();
  let mediaFiles = 0;
  for (const p of plan) {
    const f = p.m.media?.file ? file.media.get(p.m.media.file) : undefined;
    if (!f) continue;
    mediaFiles++;
    if (p.dup || !["image", "audio", "document", "sticker"].includes(p.m.media!.kind)) continue;
    if (f.size > 0 && f.size <= budget) { budget -= f.size; mediaOk.add(p); }
  }
  const fresh = plan.filter((p) => !p.dup);
  const iso = (d?: Date) => (d ? d.toISOString() : null);
  const preview: ZapPreview = {
    token, fileName, participants, casa, contact, from: iso(plan[0]?.m.at), to: iso(plan.at(-1)?.m.at), total: plan.length,
    newCount: contact ? fresh.length : plan.length, existingCount: contact ? plan.length - fresh.length : 0,
    media: { files: mediaFiles, imported: mediaOk.size, skipped: fresh.filter((p) => p.m.media && !mediaOk.has(p)).length },
    ignored: { system: parsed.system, deleted: parsed.deleted },
  };
  return { preview, plan: fresh, mediaOk, file };
}

/** Prévia: quem é quem, a cliente, o período e quantas são novas. Nada é gravado. */
export async function previewWhatsappImport(token: string, userId: string, opts: Opts & { fixedContactId?: string | null } = {}): Promise<ZapPreview> {
  return (await analyze(token, userId, opts)).preview;
}

/** Importa e apaga o arquivo temporário. Nunca envia nada: só grava as mensagens antigas na conversa. */
export async function applyWhatsappImport(token: string, userId: string, opts: Opts & { fixedContactId?: string | null } = {}): Promise<ZapReport> {
  const { preview, plan, mediaOk, file } = await analyze(token, userId, opts);
  if (!preview.contact) throw new UserFacingError("Escolha a cliente desta conversa.");
  const contactId = preview.contact.id;
  const now = new Date();
  let inserted = 0, media = 0;
  for (let i = 0; i < plan.length; i += 500) {
    const rows = [];
    for (const p of plan.slice(i, i + 500)) {
      const id = randomUUID();
      let mediaPath: string | null = null, mediaMime: string | null = null;
      if (mediaOk.has(p)) {
        const buf = await file.media.get(p.m.media!.file!)!.read();
        const mime = sniffMime(buf.subarray(0, 256 * 1024));
        if (MEDIA_MIME_OK(mime)) {
          const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "application/pdf": "pdf" } as Record<string, string>)[mime] ?? "bin";
          mediaPath = await save(`${id}.${ext}`, buf); mediaMime = mime; media++;
        }
      }
      const kind = p.m.media ? p.m.media.kind : "text";
      rows.push({
        id, contactId, dealId: null, channelId: null, direction: p.dir, kind,
        body: p.m.text || (p.m.media && !mediaPath && p.m.media.kind === "document" ? p.m.media.file : null) || null,
        mediaPath, mediaMime, status: "sent",
        sentVia: p.dir === "out" ? "celular" as const : null, fromPhone: p.dir === "out",
        editedAt: p.m.edited ? p.m.at : null, importedAt: now, importKey: p.key, createdAt: p.m.at,
        // Áudio com arquivo: o worker faz a cópia que toca no iPhone e a transcrição (só no servidor, nada sai).
        transcriptStatus: kind === "audio" && mediaPath ? "pendente" as const : null,
      });
    }
    const ins = await db.insert(messages).values(rows).onConflictDoNothing().returning({ id: messages.id });
    inserted += ins.length;
  }
  await db.insert(auditLog).values({ userId, action: "importou", entity: "whatsapp_export", entityId: contactId,
    data: { arquivo: preview.fileName, mensagens: inserted, ja_existiam: preview.existingCount, midias: media, de: preview.from, ate: preview.to } });
  await discardUpload(token);
  return { contactId, inserted, existing: preview.existingCount, media, mediaSkipped: preview.media.skipped, from: preview.from, to: preview.to };
}

/** Busca da cliente na prévia (quando o arquivo não diz quem é): nome ou telefone. */
export async function searchClientsForImport(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  return db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts)
    .where(or(sql`${contacts.name} ilike ${`%${term.replace(/[%_\\]/g, "\\$&")}%`}`, digits.length >= 4 ? sql`${contacts.phoneE164} like ${`%${digits}%`}` : undefined))
    .orderBy(contacts.name).limit(8);
}
