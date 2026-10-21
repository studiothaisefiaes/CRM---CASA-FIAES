import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, professionals } from "../db/schema";
import { isUuid } from "@/lib/uuid";
import { PHOTO_MAX_BYTES } from "@/lib/pro-photo";
import { mediaDir, readMediaFile } from "../whatsapp/media";
import { sniffMime, type SafeMime } from "../security/sniff";
import { UserFacingError } from "./errors";

const EXT: Partial<Record<SafeMime, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const THUMB = "-q.webp";

/** Miniatura quadrada de 256 px (lista e cabeçalho da Agenda). Usa o `sharp` que vem com o Next; sem ele, null (a tela recorta a original). */
export async function makeThumb(data: Uint8Array): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(data).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } catch (e) {
    console.error("[foto da profissional] miniatura:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Grava a foto no MEDIA_DIR (fora da pasta da versão), a miniatura ao lado, troca no cadastro e apaga a anterior. Tipo pelo conteúdo. */
export async function saveProfessionalPhoto(id: string, data: Uint8Array, userId: string, now = new Date()): Promise<{ photoVersion: string }> {
  if (!isUuid(id)) throw new UserFacingError("Profissional não encontrada.");
  if (!data.length) throw new UserFacingError("Escolha uma foto.");
  if (data.length > PHOTO_MAX_BYTES) throw new UserFacingError("A foto passa de 5 MB. Escolha uma menor.");
  const mime = sniffMime(data.subarray(0, 32));
  const ext = mime ? EXT[mime] : undefined;
  if (!mime || !ext) throw new UserFacingError("Use uma foto JPG, PNG ou WEBP.");
  const [p] = await db.select({ photoPath: professionals.photoPath }).from(professionals).where(eq(professionals.id, id));
  if (!p) throw new UserFacingError("Profissional não encontrada.");

  const version = String(now.getTime());
  const rel = `profissionais/${id}/${version}.${ext}`;
  const dir = path.join(mediaDir(), "profissionais", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${version}.${ext}`), data);
  const thumb = await makeThumb(data);
  if (thumb) await writeFile(path.join(dir, `${version}${THUMB}`), thumb);
  await db.transaction(async (tx) => {
    await tx.update(professionals).set({ photoPath: rel }).where(eq(professionals.id, id));
    await tx.insert(auditLog).values({ userId, action: "profissional_foto", entity: "professional", entityId: id, data: { tipo: mime, tamanho: data.length } });
  });
  if (p.photoPath && p.photoPath !== rel) {
    const old = path.join(mediaDir(), p.photoPath);
    await rm(old, { force: true }).catch(() => {});
    await rm(old.replace(/\.[a-z0-9]+$/i, THUMB), { force: true }).catch(() => {});
  }
  return { photoVersion: version };
}

/** A foto para servir: "q" = miniatura (ou a original, se não houver); "full" = a original. */
export async function readProfessionalPhoto(id: string, size: "q" | "full"): Promise<{ data: Buffer; mime: SafeMime | null; name: string } | null> {
  if (!isUuid(id)) return null;
  const [p] = await db.select({ photoPath: professionals.photoPath }).from(professionals).where(eq(professionals.id, id));
  if (!p?.photoPath) return null;
  const original = path.join(mediaDir(), p.photoPath);
  const candidates = size === "q" ? [original.replace(/\.[a-z0-9]+$/i, THUMB), original] : [original];
  for (const file of candidates) {
    const data = await readMediaFile(file).catch(() => null);
    if (data) return { data, mime: sniffMime(data.subarray(0, 32)), name: path.basename(file) };
  }
  return null;
}
