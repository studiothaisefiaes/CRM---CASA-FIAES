import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, libraryFiles } from "../db/schema";
import { save as saveMediaFile } from "../whatsapp/media";
import { safeMediaFile } from "../whatsapp/retention";
import { sendMediaFromCrm, type Upload, planMedia } from "./send";
import { assertFuncaoLigada, funcaoParam } from "./funcoes";
import { UserFacingError } from "./errors";

export const LIBRARY_TAGS = ["Preços", "Resultados", "Cuidados", "Como chegar"] as const;
export const LIBRARY_DIR = "biblioteca";
const NAME_MAX = 120, CAPTION_MAX = 1000, TAG_MAX = 30, TAGS_MAX = 10;

export type LibraryItem = { id: string; name: string; caption: string | null; tags: string[]; kind: string; sizeBytes: number | null; thumbUrl: string | null };

const audit = (userId: string, action: string, id: string, data: Record<string, unknown>) => db.insert(auditLog).values({ userId, action, entity: "biblioteca", entityId: id, data });
const cleanName = (n: string) => Array.from(path.basename(n).replace(/[\u0000-\u001f\u007f"\\]/g, "").trim()).slice(0, NAME_MAX).join("");

function cleanMeta(meta: { name: string; caption?: string | null; tags: string[] }) {
  const name = cleanName(meta.name);
  if (!name) throw new UserFacingError("Dê um nome ao arquivo.");
  const caption = meta.caption?.trim() || null;
  if (caption && caption.length > CAPTION_MAX) throw new UserFacingError(`Legenda muito longa (máximo ${CAPTION_MAX.toLocaleString("pt-BR")} caracteres).`);
  const tags = [...new Set(meta.tags.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (tags.some((t) => t.length > TAG_MAX)) throw new UserFacingError(`Etiqueta muito longa (máximo ${TAG_MAX} caracteres).`);
  if (tags.length > TAGS_MAX) throw new UserFacingError(`No máximo ${TAGS_MAX} etiquetas por arquivo.`);
  return { name, caption, tags };
}

/** Sobe um arquivo para a Biblioteca: foto, vídeo MP4, PDF ou áudio; tipo conferido pelos bytes; tamanho limitado pela função (até 16 MB). */
export async function uploadLibraryFile(file: Upload, meta: { name: string; caption?: string | null; tags: string[] }, userId: string): Promise<{ id: string }> {
  await assertFuncaoLigada("biblioteca");
  const maxMb = await funcaoParam("biblioteca", "tamanho_max_mb");
  if (!file.data.length) throw new UserFacingError("O arquivo está vazio.");
  if (file.data.length > maxMb * 1024 * 1024) throw new UserFacingError(`O arquivo passa de ${maxMb} MB. Escolha um menor.`);
  const plan = planMedia(file);
  if (!plan) throw new UserFacingError("Esse tipo de arquivo não pode ir pelo WhatsApp. Use foto, vídeo MP4, PDF ou áudio.");
  const m = cleanMeta(meta);
  if (m.caption && plan.kind === "audio") throw new UserFacingError("Áudio não aceita legenda.");
  const id = randomUUID();
  const stored = await saveMediaFile(`${LIBRARY_DIR}/${id}.${plan.ext}`, file.data);
  await db.insert(libraryFiles).values({ id, name: m.name, caption: m.caption, tags: m.tags, path: stored, mime: plan.mime, kind: plan.kind, sizeBytes: file.data.length, createdBy: userId });
  await audit(userId, "subiu", id, { nome: m.name, tipo: plan.mime, etiquetas: m.tags });
  return { id };
}

/** Muda nome, legenda e etiquetas (o arquivo em si não muda). */
export async function updateLibraryFile(id: string, meta: { name: string; caption?: string | null; tags: string[] }, userId: string): Promise<void> {
  await assertFuncaoLigada("biblioteca");
  const [row] = await db.select().from(libraryFiles).where(and(eq(libraryFiles.id, id), isNull(libraryFiles.deletedAt)));
  if (!row) throw new UserFacingError("Esse arquivo não está mais na Biblioteca.");
  const m = cleanMeta(meta);
  if (m.caption && row.kind === "audio") throw new UserFacingError("Áudio não aceita legenda.");
  await db.update(libraryFiles).set(m).where(eq(libraryFiles.id, id));
  await audit(userId, "editou", id, { nome: m.name, etiquetas: m.tags });
}

/** Apagar é lógico: o arquivo e o caminho ficam, porque as conversas que já receberam continuam mostrando. Só deixa de aparecer e de sair. */
export async function deleteLibraryFile(id: string, userId: string): Promise<void> {
  const done = await db.update(libraryFiles).set({ deletedAt: new Date() }).where(and(eq(libraryFiles.id, id), isNull(libraryFiles.deletedAt))).returning({ name: libraryFiles.name });
  if (!done.length) throw new UserFacingError("Esse arquivo não está mais na Biblioteca.");
  await audit(userId, "apagou", id, { nome: done[0].name });
}

export const thumbUrlOf = (id: string, kind: string) => (kind === "image" ? `/api/biblioteca/${id}?thumb=1` : null);

export async function listLibrary(opts: { tag?: string | null; q?: string | null } = {}): Promise<LibraryItem[]> {
  const tag = opts.tag?.trim(), q = opts.q?.trim();
  const rows = await db.select().from(libraryFiles)
    .where(and(isNull(libraryFiles.deletedAt), tag ? sql`${tag} = any(${libraryFiles.tags})` : undefined,
      q ? sql`(${libraryFiles.name} ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"} or coalesce(${libraryFiles.caption}, '') ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"})` : undefined))
    .orderBy(asc(libraryFiles.name), asc(libraryFiles.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, caption: r.caption, tags: r.tags, kind: r.kind, sizeBytes: r.sizeBytes, thumbUrl: thumbUrlOf(r.id, r.kind) }));
}

/** Etiquetas em uso (para as abas): as sugeridas primeiro, depois as que a gestão criou. */
export async function libraryTags(): Promise<string[]> {
  const rows = (await db.execute(sql`select distinct unnest(tags) as t from library_files where deleted_at is null`)).rows as { t: string }[];
  const used = new Set(rows.map((r) => r.t));
  return [...LIBRARY_TAGS.filter((t) => used.has(t)), ...[...used].filter((t) => !(LIBRARY_TAGS as readonly string[]).includes(t)).sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

const withExt = (name: string, p: string) => (path.extname(name) ? name : name + path.extname(p));

/** O arquivo para enviar. Apagado da Biblioteca, sumido do disco ou caminho fora de MEDIA_DIR = null. */
export async function readLibraryFile(id: string): Promise<{ data: Buffer; mime: string; name: string; /** Nome para o WhatsApp, com a extensão. */ fileName: string; kind: string; path: string; caption: string | null } | null> {
  const [row] = await db.select().from(libraryFiles).where(and(eq(libraryFiles.id, id), isNull(libraryFiles.deletedAt)));
  if (!row) return null;
  const file = safeMediaFile(row.path);
  if (!file) return null;
  try { return { data: await readFile(file), mime: row.mime, name: row.name, fileName: withExt(row.name, row.path), kind: row.kind, path: row.path, caption: row.caption }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}

/** Envio na hora pela atendente: o mesmo caminho de `sendMediaFromCrm` (assinatura, pendente, eco, visto azul). Legenda: a digitada ou a da Biblioteca. */
export async function sendLibraryFile(dealId: string, fileId: string, caption: string | null, userId: string): Promise<void> {
  await assertFuncaoLigada("biblioteca");
  const f = await readLibraryFile(fileId);
  if (!f) throw new UserFacingError("Esse arquivo não está mais na Biblioteca.");
  const text = f.kind === "audio" ? null : (caption?.trim() || f.caption);
  await sendMediaFromCrm(dealId, { name: f.fileName, mime: f.mime, data: f.data }, text, userId);
}
