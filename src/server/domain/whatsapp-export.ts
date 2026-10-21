import JSZip from "jszip";
import { normalizePhone } from "./phone";
import { UserFacingError } from "./errors";

/**
 * Leitura do "Exportar conversa" do WhatsApp (Android e iPhone, em português). Função pura: não grava nada.
 * Android: `16/10/2026 14:32 - Fulana: texto`. iPhone: `[16/10/2026, 14:32:05] Fulana: texto` (com marcas invisíveis U+200E).
 * Linha sem data é continuação da mensagem de cima. Mensagens do sistema (criptografia, "mudou o número", ligações) e apagadas ficam de fora.
 */
export type ExportMedia = { kind: "image" | "audio" | "video" | "document" | "sticker" | "other"; file: string | null };
export type ExportMessage = { at: Date; sender: string; text: string; media: ExportMedia | null; edited: boolean; line: number };
export type ParsedExport = { messages: ExportMessage[]; senders: string[]; system: number; deleted: number; group: boolean };

const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
const IPHONE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s?(.*)$/;
const ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+-\s+(.*)$/;
const DELETED = /^(esta mensagem foi apagada|mensagem apagada|você apagou esta mensagem|voce apagou esta mensagem|this message was deleted|you deleted this message)\.?$/i;
const EDITED = /\s*<(mensagem editada|esta mensagem foi editada|this message was edited)>\s*$/i;
const SYSTEM_TEXT = /criptografia de ponta a ponta|end-to-end encrypted|^mensagens temporárias|^as mensagens temporárias|^ligação de (voz|vídeo)|^chamada de (voz|vídeo)|^esta empresa (usa|trabalha)|^você (bloqueou|desbloqueou) este contato|^(missed )?(voice|video) call/i;
const HIDDEN = /^(<m[íi]dia oculta>|<media omitted>|null|(imagem|foto|áudio|audio|vídeo|video|figurinha|documento|gif|sticker|image|contato|cartão de contato)\s+(omitid[oa]|ocultad[oa]|omitted))$/i;
const ANDROID_FILE = /^(.+?\.[A-Za-z0-9]{2,5}) \((arquivo anexado|file attached)\)$/i;
const IPHONE_FILE = /<(anexado|attached):\s*([^>]+?)>/i;

/** Tipo pela extensão do arquivo (ou pela palavra da mídia oculta). Figurinha do Android: STK-….webp. */
export function mediaKindOf(name: string): ExportMedia["kind"] {
  const n = name.toLowerCase();
  if (/(^|[\/-])stk-|sticker|figurinha/.test(n) && /\.webp$|figurinha|sticker/.test(n)) return "sticker";
  if (/\.(jpe?g|png|webp|gif|heic)$|imagem|foto|image/.test(n)) return "image";
  if (/\.(opus|ogg|oga|m4a|mp3|aac|amr)$|áudio|audio|ptt/.test(n)) return "audio";
  if (/\.(mp4|mov|3gp|webm|m4v)$|vídeo|video/.test(n)) return "video";
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip)$|documento/.test(n)) return "document";
  return "other";
}

/** Data do celular (hora de Salvador, UTC-3 sem horário de verão) para o instante certo. */
function bahiaDate(d: string, mo: string, y: string, h: string, mi: string, s?: string): Date | null {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const [dd, mm, hh, min, ss] = [Number(d), Number(mo), Number(h), Number(mi), Number(s ?? 0)];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || min > 59 || ss > 59) return null;
  const at = new Date(Date.UTC(year, mm - 1, dd, hh + 3, min, ss));
  return Number.isNaN(at.getTime()) ? null : at;
}

type Raw = { at: Date; sender: string | null; body: string; lrm: boolean; line: number };

export function parseWhatsappExport(text: string): ParsedExport {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const raws: Raw[] = [];
  lines.forEach((original, i) => {
    const line = original.replace(/^[‎‏‪-‮]+/, "");
    const m = IPHONE.exec(line) ?? ANDROID.exec(line);
    const at = m ? bahiaDate(m[1], m[2], m[3], m[4], m[5], m[6]) : null;
    if (!m || !at) { if (raws.length) raws[raws.length - 1].body += `\n${original}`; return; }
    const rest = m[7];
    const sep = rest.indexOf(": ");
    // "Fulana: texto". Sem ": " é aviso do sistema ("Fulana mudou o número", "criou o grupo").
    if (sep <= 0) raws.push({ at, sender: null, body: rest, lrm: false, line: i + 1 });
    else {
      const body = rest.slice(sep + 2);
      raws.push({ at, sender: rest.slice(0, sep).replace(INVISIBLE, "").trim(), body, lrm: /^[‎‏]/.test(body), line: i + 1 });
    }
  });

  const out: ExportMessage[] = [];
  let system = 0, deleted = 0, groupHint = false;
  for (const r of raws) {
    const clean = r.body.replace(INVISIBLE, "").trim();
    if (!r.sender) { system++; if (/criou (o )?grupo|created group|adicionou|added/i.test(clean)) groupHint = true; continue; }
    if (DELETED.test(clean)) { deleted++; continue; }
    const edited = EDITED.test(clean);
    let body = clean.replace(EDITED, "").trim();
    let media: ExportMedia | null = null;
    const firstLine = body.split("\n")[0];
    const android = ANDROID_FILE.exec(firstLine.trim());
    const iphone = IPHONE_FILE.exec(body);
    if (android) { media = { kind: mediaKindOf(android[1]), file: android[1].trim() }; body = body.split("\n").slice(1).join("\n").trim(); }
    else if (iphone) {
      media = { kind: mediaKindOf(iphone[2]), file: iphone[2].trim() };
      body = body.replace(IPHONE_FILE, "").trim();
      // Documento do iPhone: "Nome.pdf • 3 páginas" antes do anexo; fica só o nome do arquivo.
      if (media.kind === "document") body = body.replace(/\s*•[\s\S]*$/, "").trim();
    } else if (HIDDEN.test(firstLine.trim())) {
      media = { kind: firstLine.trim().startsWith("<") || /^null$/i.test(firstLine.trim()) ? "other" : mediaKindOf(firstLine), file: null };
      body = body.split("\n").slice(1).join("\n").trim();
    } else if (r.lrm || SYSTEM_TEXT.test(body)) { system++; continue; } // iPhone: aviso do sistema vem com o nome da conversa e a marca invisível
    if (!media && !body) continue;
    out.push({ at: r.at, sender: r.sender, text: body, media, edited, line: r.line });
  }
  const senders = [...new Set(out.map((m) => m.sender))];
  return { messages: out, senders, system, deleted, group: senders.length > 2 || groupHint };
}

/** "Conversa do WhatsApp com +55 71 99999-0011.zip" → telefone e nome; serve também para "WhatsApp Chat with …" e "WhatsApp Chat - …". */
export function exportTitle(fileName: string): { label: string | null; phone: string | null } {
  const base = fileName.split(/[\\/]/).pop()!.replace(/\.(zip|txt)$/i, "").replace(/\s*\(\d+\)$/, "").trim();
  const m = /(?:conversa do whatsapp com|whatsapp chat with|whatsapp chat -)\s+(.+)$/i.exec(base);
  const label = m ? m[1].trim() : null;
  return { label, phone: label && looksLikePhone(label) ? normalizePhone(label) : null };
}
export const looksLikePhone = (s: string) => /^[+\d][\d\s().-]{7,}$/.test(s.trim()) && s.replace(/\D/g, "").length >= 10;

export const EXPORT_TEXT_MAX_BYTES = 20 * 1024 * 1024;
/** Teto de arquivos dentro do .zip (revisão de segurança 17/10, M5). Uma exportação de verdade com 50 MB tem bem menos que isso. */
export const EXPORT_MAX_FILES = 5_000;
const CORRUPT = "O .zip está corrompido. Exporte a conversa de novo.";

/**
 * Quantas entradas o diretório central tem de verdade, sem abrir o .zip. O JSZip monta um objeto por entrada antes de qualquer
 * conferência e lê o diretório até a assinatura parar de bater (ignora a contagem que o fim do .zip declara), então contamos igual.
 * zip64 (offset ou contagem no máximo) não aparece numa exportação do WhatsApp de até 50 MB: vale como corrompido.
 */
function centralDirEntries(bytes: Uint8Array): number | "zip64" | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const cdOffset = v.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || v.getUint16(eocd + 10, true) === 0xffff) return "zip64";
  let n = 0;
  for (let at = cdOffset; at + 46 <= bytes.length && v.getUint32(at, true) === 0x02014b50; n++) {
    at += 46 + v.getUint16(at + 28, true) + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    if (n > EXPORT_MAX_FILES) break;
  }
  return n;
}

type ZipStream = { on(e: "data", cb: (c: Uint8Array) => void): ZipStream; on(e: "end", cb: () => void): ZipStream; on(e: "error", cb: (err: Error) => void): ZipStream; pause(): ZipStream; resume(): ZipStream };
/**
 * Descompacta contando os bytes de verdade (M5): passou de `max`, para o fluxo na hora e recusa. O tamanho que o .zip declara
 * pode ser mentira (bomba de zip): nunca é ele que decide quanto vai para a memória.
 */
function inflateCapped(f: JSZip.JSZipObject, max: number, tooBig: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0, settled = false;
    const stop = (e: Error | null, data?: Uint8Array) => { if (settled) return; settled = true; if (e) reject(e); else resolve(data!); };
    const s = (f as unknown as { internalStream(t: "uint8array"): ZipStream }).internalStream("uint8array");
    s.on("data", (c) => {
      if (settled) return;
      total += c.length;
      if (total > max) { s.pause(); stop(new UserFacingError(tooBig)); return; }
      chunks.push(c);
    }).on("error", () => stop(new UserFacingError(CORRUPT)))
      .on("end", () => { const out = new Uint8Array(total); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } stop(null, out); })
      .resume();
  });
}
export type ExportFile = { chat: string; media: Map<string, { size: number; read: () => Promise<Buffer> }> };

/** Abre o .txt ou o .zip (com o _chat.txt e as mídias). Mídias ficam para ler depois, só as que couberem. */
export async function readExportFile(fileName: string, bytes: Uint8Array): Promise<ExportFile> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    if (!/\.txt$/i.test(fileName) && /\.zip$/i.test(fileName)) throw new UserFacingError("O .zip está corrompido. Exporte a conversa de novo.");
    if (bytes.length > EXPORT_TEXT_MAX_BYTES) throw new UserFacingError("O texto da conversa passa de 20 MB.");
    return { chat: new TextDecoder("utf-8").decode(bytes), media: new Map() };
  }
  const entries = centralDirEntries(bytes);
  if (entries === "zip64") throw new UserFacingError(CORRUPT);
  if (entries != null && entries > EXPORT_MAX_FILES) throw new UserFacingError("O .zip tem arquivos demais. Exporte só a conversa (sem mídia) ou envie o .txt.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new UserFacingError("Não deu para abrir o .zip. Exporte a conversa de novo."); }
  const files = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX/"));
  if (Object.keys(zip.files).length > EXPORT_MAX_FILES) throw new UserFacingError("O .zip tem arquivos demais. Exporte só a conversa (sem mídia) ou envie o .txt.");
  const size = (f: JSZip.JSZipObject) => Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0);
  const texts = files.filter((f) => /\.txt$/i.test(f.name));
  const chatFile = texts.find((f) => /(^|\/)_chat\.txt$/i.test(f.name)) ?? texts.find((f) => /whatsapp/i.test(f.name)) ?? texts[0];
  if (!chatFile) throw new UserFacingError("O .zip não tem o texto da conversa (_chat.txt). Exporte a conversa de novo.");
  if (size(chatFile) > EXPORT_TEXT_MAX_BYTES) throw new UserFacingError("O texto da conversa passa de 20 MB.");
  const chat = new TextDecoder("utf-8").decode(await inflateCapped(chatFile, EXPORT_TEXT_MAX_BYTES, "O texto da conversa passa de 20 MB."));
  const media = new Map<string, { size: number; read: () => Promise<Buffer> }>();
  for (const f of files) {
    if (f === chatFile) continue;
    const name = f.name.split("/").pop()!;
    // A mídia lê no máximo o tamanho que declarou (é por ele que a importação escolhe o que cabe): mais que isso é .zip adulterado.
    const declaredSize = size(f);
    media.set(name, { size: declaredSize, read: async () => Buffer.from(await inflateCapped(f, declaredSize, CORRUPT)) });
  }
  return { chat, media };
}
