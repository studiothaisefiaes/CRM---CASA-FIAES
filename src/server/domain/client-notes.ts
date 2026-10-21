import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, auditLog, clientNotes } from "../db/schema";
import { UserFacingError } from "./errors";
import { mediaDir } from "../whatsapp/media";
import { PHOTO_EXT, sniffPhoto } from "../security/sniff";

export const NOTE_MAX = 2000;
export const NOTE_PHOTO_MAX = 5 * 1024 * 1024;
const DAY = 86_400_000;

/**
 * Anotação da ficha técnica. Vem da profissional, que só anota em horário dela, ou da recepção ("Anotar para a profissional"), em qualquer horário.
 * A nota fica para a profissional do horário. A foto é opcional, até 5 MB, com o tipo conferido pelos bytes, e vai para MEDIA_DIR/notas/.
 */
export async function addClientNote(input: { appointmentId: string; body: string; photo?: { data: Buffer } | null }, actor: { userId: string; professionalId: string | null }, now = new Date()): Promise<{ id: string }> {
  const body = input.body.trim();
  if (!body) throw new UserFacingError("Escreva a anotação.");
  if (body.length > NOTE_MAX) throw new UserFacingError("Use até 2.000 caracteres.");
  const [a] = await db.select({ contactId: appointments.contactId, professionalId: appointments.professionalId, twin: appointments.avecTwinOf }).from(appointments).where(eq(appointments.id, input.appointmentId));
  if (!a || a.twin || (actor.professionalId && a.professionalId !== actor.professionalId)) throw new UserFacingError("Horário não encontrado.");
  if (!a.contactId) throw new UserFacingError("Essa cliente ainda não tem ficha no CRM: não dá para anotar.");
  const id = randomUUID();
  let media: { rel: string; mime: string } | null = null;
  if (input.photo) {
    if (input.photo.data.length > NOTE_PHOTO_MAX) throw new UserFacingError("A foto passa de 5 MB. Escolha uma menor.");
    const mime = sniffPhoto(input.photo.data.subarray(0, 64));
    if (!mime) throw new UserFacingError("Envie uma foto (JPEG, PNG, WebP ou HEIC).");
    media = { rel: `notas/${id}.${PHOTO_EXT[mime]}`, mime };
    await mkdir(path.join(mediaDir(), "notas"), { recursive: true });
    await writeFile(path.join(mediaDir(), media.rel), input.photo.data);
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(clientNotes).values({ id, contactId: a.contactId!, authorId: actor.userId, professionalId: actor.professionalId ?? a.professionalId, appointmentId: input.appointmentId,
        body, mediaPath: media?.rel ?? null, mediaMime: media?.mime ?? null, createdAt: now });
      await tx.insert(auditLog).values({ userId: actor.userId, action: "anotou_ficha", entity: "contact", entityId: a.contactId!, data: { nota: id, horario: input.appointmentId, foto: !!media } });
    });
  } catch (e) {
    if (media) await unlink(path.join(mediaDir(), media.rel)).catch(() => {});
    throw e;
  }
  return { id };
}

/** A profissional vê a foto de cliente com quem tem horário entre 60 dias atrás e 60 dias à frente (seção 8.3). */
export async function canSeeNotePhoto(userId: string, contactId: string, now: Date): Promise<boolean> {
  const from = new Date(now.getTime() - 60 * DAY).toISOString(), to = new Date(now.getTime() + 60 * DAY).toISOString();
  const r = await db.execute(sql`select 1 from appointments a join professionals p on p.id = a.professional_id
    where p.user_id = ${userId} and p.active and a.contact_id = ${contactId} and a.avec_twin_of is null
      and a.starts_at >= ${from}::timestamptz and a.starts_at <= ${to}::timestamptz limit 1`);
  return r.rows.length > 0;
}
