import path from "node:path";

/** Tipos que o CRM aceita servir; qualquer outra coisa (html, svg, xml, texto…) vira download binário. */
export type SafeMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "video/mp4" | "video/webm" | "application/pdf";

const at = (buf: Uint8Array, offset: number, ...bytes: number[]) => buf.length >= offset + bytes.length && bytes.every((x, i) => buf[offset + i] === x);
const ascii = (buf: Uint8Array, offset: number, s: string) => at(buf, offset, ...[...s].map((c) => c.charCodeAt(0)));

/**
 * MP4 sem marca de áudio (Safari/iOS gravam "isom"/"iso5"/"mp42"): é áudio se o que está declarado nos boxes `hdlr`
 * é só som. Procura nos bytes recebidos (use um trecho maior que 32 bytes para isto funcionar); sem `hdlr` visível, vale vídeo.
 */
function mp4HasOnlyAudio(buf: Uint8Array) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 256 * 1024));
  let audio = false;
  for (let i = b.indexOf("hdlr"); i !== -1; i = b.indexOf("hdlr", i + 4)) {
    const handler = b.toString("latin1", i + 12, i + 16);
    if (handler === "vide") return false;
    if (handler === "soun") audio = true;
  }
  return audio;
}

/** Tipo real do arquivo pelos primeiros bytes. Nunca confia no mimetype declarado pelo remetente. */
export function sniffMime(buf: Uint8Array): SafeMime | null {
  if (at(buf, 0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(buf, 0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (ascii(buf, 0, "GIF8")) return "image/gif";
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WEBP")) return "image/webp";
  if (ascii(buf, 0, "%PDF-")) return "application/pdf";
  if (ascii(buf, 0, "OggS")) return "audio/ogg";
  if (ascii(buf, 0, "ID3")) return "audio/mpeg";
  // Frame MPEG Layer III: sync de 11 bits + layer 01 + versão válida. Recusa FF FE/FF FF (BOM UTF-16 antes de HTML) e AAC (layer 00).
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2 && (buf[1] & 0x18) !== 0x08) return "audio/mpeg";
  if (ascii(buf, 4, "ftyp")) return ascii(buf, 8, "M4A") || ascii(buf, 8, "M4B") || mp4HasOnlyAudio(buf) ? "audio/mp4" : "video/mp4";
  if (at(buf, 0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  return null;
}

/** Abre no navegador: imagem, áudio e vídeo. PDF vai como download (o sandbox bloqueia o visualizador do Chrome). */
const INLINE = (m: SafeMime) => m.startsWith("image/") || m.startsWith("audio/") || m.startsWith("video/");

/** Extensões aceitas por tipo (a primeira é a que se acrescenta quando falta). */
const EXTS: Record<SafeMime, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"], "image/gif": ["gif"],
  "audio/ogg": ["ogg", "oga", "opus"], "audio/mpeg": ["mp3"], "audio/mp4": ["m4a", "mp4", "aac"],
  "video/mp4": ["mp4", "m4v", "mov"], "video/webm": ["webm"], "application/pdf": ["pdf"],
};

/** Nome seguro para o cabeçalho, até 80 caracteres, terminando na extensão do tipo detectado. */
function safeName(fileName: string, detected: SafeMime | null) {
  // Array.from: conta por caractere (não por unidade UTF-16) para não partir emoji ao meio.
  const chars = Array.from(path.basename(fileName).replace(/["\\]/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim());
  const lower = chars.join("").toLowerCase();
  const has = detected && EXTS[detected].find((e) => lower.endsWith("." + e));
  const suffix = has ? chars.slice(-(has.length + 1)) : detected ? Array.from("." + EXTS[detected][0]) : [];
  const stem = has ? chars.slice(0, -(has.length + 1)) : chars;
  return (stem.length ? stem : Array.from("arquivo")).slice(0, 80 - suffix.length).join("") + suffix.join("");
}

/** Cabeçalhos de resposta para um arquivo de mídia: tipo detectado, nosniff, sandbox e disposição segura. */
export function mediaHeaders(detected: SafeMime | null, fileName: string): Record<string, string> {
  const name = safeName(fileName, detected);
  const fallback = name.replace(/[^\x20-\x7e]/gu, "_");
  const disposition = `${detected && INLINE(detected) ? "inline" : "attachment"}; filename="${fallback}"${fallback === name ? "" : `; filename*=UTF-8''${encodeURIComponent(name)}`}`;
  return {
    "content-type": detected ?? "application/octet-stream",
    "content-disposition": disposition,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "cache-control": "private, max-age=31536000, immutable",
  };
}

/** Foto da anotação da ficha (Lote 7A). Só para as anotações: o envio de mídia continua no `sniffMime`, que não muda. */
export type PhotoMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic";
export const PHOTO_EXT: Record<PhotoMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
const HEIC_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"];

/** JPEG, PNG, WebP ou HEIC (o formato da câmera do iPhone), pelos bytes. Qualquer outra coisa: null. */
export function sniffPhoto(buf: Uint8Array): PhotoMime | null {
  if (ascii(buf, 4, "ftyp") && HEIC_BRANDS.some((b) => ascii(buf, 8, b))) return "image/heic";
  const m = sniffMime(buf);
  return m === "image/jpeg" || m === "image/png" || m === "image/webp" ? m : null;
}

/** Cabeçalhos da foto: o tipo conferido, sem o navegador adivinhar, sem rodar nada e sem cache compartilhado. */
export const photoHeaders = (mime: PhotoMime): Record<string, string> => ({
  "content-type": mime, "content-disposition": "inline", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "private, max-age=3600",
});
