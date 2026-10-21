"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { deleteLibraryFile, updateLibraryFile, uploadLibraryFile } from "@/server/domain/library";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "biblioteca") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "biblioteca.gerir"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/biblioteca"); return { ok: true, data }; } catch (e) { return fail(e); }
}
const uuid = z.string().uuid();
const meta = z.object({ name: z.string().max(200), caption: z.string().max(1000).nullish(), tags: z.array(z.string().max(60)).max(20) });

/** Sobe um arquivo (FormData: file, name, caption?, tags = JSON de lista). Exige `biblioteca.gerir` no servidor. */
export const uploadLibraryFileAction = async (form: FormData) => run(async (u) => {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Escolha um arquivo.");
  const m = meta.parse({ name: form.get("name") || file.name, caption: form.get("caption") || null, tags: JSON.parse(String(form.get("tags") || "[]")) });
  return uploadLibraryFile({ name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, { name: m.name, caption: m.caption ?? null, tags: m.tags }, u);
});
export const updateLibraryFileAction = async (id: string, input: { name: string; caption: string | null; tags: string[] }) =>
  run((u) => { const m = meta.parse(input); return updateLibraryFile(uuid.parse(id), { name: m.name, caption: m.caption ?? null, tags: m.tags }, u); });
export const deleteLibraryFileAction = async (id: string) => run((u) => deleteLibraryFile(uuid.parse(id), u));
