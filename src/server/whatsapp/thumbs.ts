import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileEtag } from "../http/etag";
import { sniffMime } from "../security/sniff";
import { mediaDir } from "./media";

/**
 * Miniaturas das fotos de perfil e das imagens da conversa (17/10, perf-conversa2).
 *
 * A Fila pedia dezenas de fotos no tamanho original (média 51 KB, até 164 KB, para mostrar com 28–44 px) e a conversa as imagens inteiras
 * (média 140 KB, até 1,4 MB, mostradas com no máximo 288 px): com ~120 KB/s até o servidor, cada foto levava segundos e atrasava a conversa.
 * A miniatura é feita na primeira vez (sharp) e guardada no disco (`MEDIA_DIR/thumbs`) e na memória; depois sai em poucos ms.
 * A chave leva a ETag do arquivo de origem (tamanho + data): foto trocada pelo worker no mesmo nome gera outra miniatura e apaga a velha.
 */
export const AVATAR_THUMB_PX = 128;
export const IMAGE_THUMB_PX = 720;
const QUALITY = 72;
/** Só estes viram miniatura; GIF (animado) e o resto saem como estão. */
const THUMBABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Gerações ao mesmo tempo: o sharp usa as 4 threads do libuv, e as outras leituras de disco do servidor não podem ficar esperando. */
const MAX_CONCURRENT = 2;
const MEMORY_MAX = 300;

export const thumbsDir = () => path.join(mediaDir(), "thumbs");
export type Thumb = { data: Buffer; etag: string };

const memory = new Map<string, Thumb>();
const inflight = new Map<string, Promise<Thumb | null>>();
let running = 0;
const waiting: (() => void)[] = [];
/** Só testes: quantas miniaturas o sharp gerou. */
export const __thumbStats = { generated: 0 };
/** Só testes: esquece as miniaturas guardadas na memória (o disco continua). */
export function __clearThumbMemory() { memory.clear(); }

function remember(key: string, t: Thumb) {
  memory.delete(key);
  memory.set(key, t);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

async function headOf(file: string): Promise<Uint8Array | null> {
  const fh = await open(file, "r").catch(() => null);
  if (!fh) return null;
  try { const buf = new Uint8Array(64); const { bytesRead } = await fh.read(buf, 0, 64, 0); return buf.subarray(0, bytesRead); } finally { await fh.close(); }
}

/** Apaga as miniaturas dos arquivos de origem (retenção): uma leitura da pasta para o lote inteiro. */
export async function removeThumbs(baseNames: string[]) {
  if (!baseNames.length) return;
  const prefixes = baseNames.map((b) => `${b}.`);
  const mine = (f: string) => prefixes.some((p) => f.startsWith(p));
  for (const k of [...memory.keys()]) if (mine(k)) memory.delete(k);
  const files = await readdir(thumbsDir()).catch(() => [] as string[]);
  await Promise.all(files.filter(mine).map((f) => unlink(path.join(thumbsDir(), f)).catch(() => {})));
}

/**
 * A miniatura WebP de `file` (no máximo `px` de lado; `square`: recorta no centro, para a foto redonda). null quando o arquivo não existe
 * ou não é JPEG/PNG/WebP — quem chama serve o original.
 */
export async function thumbnail(file: string, opts: { px: number; square: boolean }): Promise<Thumb | null> {
  const src = await fileEtag(file);
  if (!src) return null;
  // Nome: o do arquivo (legível, e o prefixo que a retenção apaga) + qual arquivo (caminho dentro de MEDIA_DIR) + qual versão (ETag).
  const base = path.basename(file);
  const where = createHash("sha1").update(path.relative(mediaDir(), file)).digest("hex").slice(0, 6);
  const tag = createHash("sha1").update(`${where}:${src}`).digest("hex").slice(0, 12);
  const name = `${base}.${where}-${tag}.${opts.px}${opts.square ? "q" : ""}.webp`;
  const hit = memory.get(name);
  if (hit) return hit;
  const pending = inflight.get(name);
  if (pending) return pending;
  const etag = `W/"t${opts.px}-${tag}"`;
  const job = (async (): Promise<Thumb | null> => {
    const disk = path.join(thumbsDir(), name);
    const cached = await readFile(disk).catch(() => null);
    if (cached) { const t = { data: cached, etag }; remember(name, t); return t; }
    // Só o começo do arquivo para saber o tipo (áudio e vídeo não são lidos inteiros à toa).
    const head = await headOf(file);
    if (!head || !THUMBABLE.has(sniffMime(head) ?? "")) return null;
    const data = await slot(() => sharp(file, { failOn: "none" }).rotate()
      .resize(opts.px, opts.px, { fit: opts.square ? "cover" : "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY }).toBuffer()).catch((e) => { console.error("[miniatura] não gerou", base, e instanceof Error ? e.message : e); return null; });
    if (!data) return null;
    __thumbStats.generated++;
    const t = { data, etag };
    // Guardar no disco é só economia: disco cheio ou sem permissão não pode tirar a foto da tela (serve a da memória).
    const tmp = `${disk}.${process.pid}.${Date.now()}.tmp`;
    try {
      await mkdir(thumbsDir(), { recursive: true });
      await writeFile(tmp, data);
      await rename(tmp, disk);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      console.error("[miniatura] não guardou no disco", base, e instanceof Error ? e.message : e);
      remember(name, t);
      return t;
    }
    // A retenção apagou a origem enquanto a miniatura era feita: a cópia não pode ficar no disco.
    if (!(await fileEtag(file))) { await unlink(disk).catch(() => {}); return null; }
    // A foto trocou (outra ETag): as miniaturas velhas deste arquivo e deste tamanho saem do disco.
    const sameFile = `${base}.${where}-`, sameSize = `.${opts.px}${opts.square ? "q" : ""}.webp`;
    const old = (f: string) => f.startsWith(sameFile) && f.endsWith(sameSize) && f !== name;
    for (const k of [...memory.keys()]) if (old(k)) memory.delete(k);
    const files = await readdir(thumbsDir()).catch(() => [] as string[]);
    await Promise.all(files.filter(old).map((f) => unlink(path.join(thumbsDir(), f)).catch(() => {})));
    remember(name, t);
    return t;
  })().finally(() => inflight.delete(name));
  inflight.set(name, job);
  return job;
}
