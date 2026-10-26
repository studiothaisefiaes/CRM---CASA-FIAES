"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { attachToQuickReply, detachFromQuickReply, setQuickReplyFolder, setQuickReplyIaQuando } from "@/server/domain/quick-replies";
import { MAX_RAW_VIDEO_BYTES } from "@/server/whatsapp/video";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "respostas") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.diaadia"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/listas"); return { ok: true, data }; } catch (e) { return fail(e); }
}
const uuid = z.string().uuid();

export const setQuickReplyFolderAction = async (id: string, folder: string | null) => run((u) => setQuickReplyFolder(uuid.parse(id), folder, u));
export const attachQuickReplyFileAction = async (form: FormData) => run(async (u) => {
  const id = uuid.parse(form.get("id"));
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Escolha um arquivo.");
  // Vídeo bruto vai até 64 MB (é comprimido no servidor); o limite de cada tipo (16 MB, depois de comprimir) é conferido em attachToQuickReply.
  if (file.size > MAX_RAW_VIDEO_BYTES) throw new Error("O arquivo passa de 64 MB. Escolha um menor.");
  const att = await attachToQuickReply(id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, u);
  return { name: att.name, kind: att.kind };
});
export const detachQuickReplyFileAction = async (id: string) => run((u) => detachFromQuickReply(uuid.parse(id), u));
/** "A IA indica quando…": só a gestão (config.sistema), na resposta universal com foto/vídeo (conferido em setQuickReplyIaQuando). */
export const setQuickReplyIaQuandoAction = async (id: string, text: string | null) =>
  run((u) => setQuickReplyIaQuando(uuid.parse(id), z.string().max(400).nullable().parse(text), { id: u, canShare: true }), "config.sistema");
