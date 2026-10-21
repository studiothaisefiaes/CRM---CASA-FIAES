import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, clientPhotos, contacts, settings, visits } from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncao } from "./funcoes";
import { mediaDir } from "../whatsapp/media";
import { PHOTO_EXT, sniffPhoto } from "../security/sniff";
import {
  PHOTO_KINDS, PHOTO_MAX_MB_DEFAULT, PHOTO_MAX_MB_MAX, PHOTO_MAX_MB_MIN, clientPhotoUrl, type ClientPhotoItem, type PhotoKind,
} from "@/lib/client-photos";

type Q = Tx | typeof db;
const KEY = "fotos_cliente";
const NOT_FOUND = "Foto não encontrada.";

/** O tamanho máximo da foto. Valor ausente ou fora de 1 a 20 → 5 MB. */
export async function getPhotoConfig(q: Q = db): Promise<{ maxMb: number }> {
  const raw = (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)))[0]?.value;
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).maxMb : undefined;
  const ok = typeof v === "number" && Number.isInteger(v) && v >= PHOTO_MAX_MB_MIN && v <= PHOTO_MAX_MB_MAX;
  return { maxMb: ok ? v : PHOTO_MAX_MB_DEFAULT };
}

const configSchema = z.object({
  maxMb: z.number().int(`Use um número inteiro de ${PHOTO_MAX_MB_MIN} a ${PHOTO_MAX_MB_MAX} MB.`)
    .min(PHOTO_MAX_MB_MIN, `Use de ${PHOTO_MAX_MB_MIN} a ${PHOTO_MAX_MB_MAX} MB.`).max(PHOTO_MAX_MB_MAX, `Use de ${PHOTO_MAX_MB_MIN} a ${PHOTO_MAX_MB_MAX} MB.`),
}).strict();

/** Muda o tamanho máximo da foto (quem pode, a action confere: config.fichas). Função `fotos`. */
export async function savePhotoConfig(input: { maxMb: number }, userId: string): Promise<{ maxMb: number }> {
  await assertFuncao("fotos");
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Tamanho inválido.");
  const value = parsed.data;
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: KEY, data: value });
  });
  return value;
}

/**
 * Foto real (câmera ou arquivo) de antes ou depois, da cliente e, se quiser, de uma visita dela. Até o tamanho máximo (padrão 5 MB), com o tipo
 * conferido pelos bytes, gravada como veio (sem recorte, filtro ou edição) em MEDIA_DIR/galeria/<id>.<ext>. Quem pode (fotos.adicionar), a action confere.
 */
export async function addClientPhoto(input: { contactId: string; visitId?: string | null; kind: PhotoKind; data: Buffer }, userId: string): Promise<{ id: string }> {
  await assertFuncao("fotos");
  if (!(PHOTO_KINDS as readonly string[]).includes(input.kind)) throw new UserFacingError("Escolha se a foto é de antes ou de depois.");
  const { maxMb } = await getPhotoConfig();
  if (input.data.length > maxMb * 1024 * 1024) throw new UserFacingError(`A foto passa de ${maxMb} MB. Escolha uma menor.`);
  const mime = sniffPhoto(input.data.subarray(0, 64));
  if (!mime) throw new UserFacingError("Envie uma foto (JPEG, PNG, WebP ou HEIC).");
  const [contact] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
  if (!contact) throw new UserFacingError("Cliente não encontrada.");
  if (input.visitId) {
    const [visit] = await db.select({ contactId: visits.contactId }).from(visits).where(eq(visits.id, input.visitId));
    if (!visit) throw new UserFacingError("Visita não encontrada.");
    if (visit.contactId !== input.contactId) throw new UserFacingError("Essa visita não é desta cliente.");
  }
  const id = randomUUID();
  const rel = `galeria/${id}.${PHOTO_EXT[mime]}`;
  await mkdir(path.join(mediaDir(), "galeria"), { recursive: true });
  await writeFile(path.join(mediaDir(), rel), input.data);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(clientPhotos).values({ id, contactId: input.contactId, visitId: input.visitId ?? null, kind: input.kind, mediaPath: rel, mediaMime: mime, createdBy: userId });
      await tx.insert(auditLog).values({ userId, action: "adicionou_foto_cliente", entity: "contact", entityId: input.contactId, data: { foto: id, kind: input.kind, visitId: input.visitId ?? null } });
    });
  } catch (e) {
    await unlink(path.join(mediaDir(), rel)).catch(() => {});
    throw e;
  }
  return { id };
}

/** Tira a foto da ficha: só marca deleted_at e deleted_by (o arquivo fica guardado). Quem pode (fotos.apagar), a action confere. */
export async function removeClientPhoto(id: string, userId: string): Promise<void> {
  await assertFuncao("fotos");
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ contactId: clientPhotos.contactId, deletedAt: clientPhotos.deletedAt }).from(clientPhotos).where(eq(clientPhotos.id, id)).for("update");
    if (!p || p.deletedAt) throw new UserFacingError(NOT_FOUND);
    await tx.update(clientPhotos).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(clientPhotos.id, id));
    await tx.insert(auditLog).values({ userId, action: "apagou_foto_cliente", entity: "contact", entityId: p.contactId, data: { foto: id } });
  });
}

/** As fotos da cliente que não foram apagadas, da mais antiga à mais nova, com o dia da visita (se tiver) e o endereço protegido da imagem. */
export async function listClientPhotos(contactId: string, q: Q = db): Promise<ClientPhotoItem[]> {
  const rows = await q.select({ id: clientPhotos.id, visitId: clientPhotos.visitId, day: visits.day, kind: clientPhotos.kind })
    .from(clientPhotos).leftJoin(visits, eq(visits.id, clientPhotos.visitId))
    .where(and(eq(clientPhotos.contactId, contactId), isNull(clientPhotos.deletedAt)))
    .orderBy(asc(clientPhotos.createdAt), asc(clientPhotos.id));
  return rows.map((r) => ({ id: r.id, visitId: r.visitId, day: r.day, kind: r.kind as PhotoKind, url: clientPhotoUrl(contactId, r.id) }));
}

/** Para a rota: a foto (não apagada) daquela cliente, com o caminho e o tipo. */
export async function findClientPhotoFile(contactId: string, photoId: string): Promise<{ mediaPath: string; mediaMime: string } | null> {
  const [p] = await db.select({ mediaPath: clientPhotos.mediaPath, mediaMime: clientPhotos.mediaMime })
    .from(clientPhotos).where(and(eq(clientPhotos.id, photoId), eq(clientPhotos.contactId, contactId), isNull(clientPhotos.deletedAt)));
  return p ?? null;
}
