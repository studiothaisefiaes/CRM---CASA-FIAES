"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { decodeCsv } from "@/server/domain/chatguru-csv";
import { applyChatguruCsv, CHATGURU_CSV_MAX_BYTES, previewChatguruCsv } from "@/server/domain/chatguru-csv-import";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues[0]?.message ?? "Arquivo inválido." : userErrorMessage(e, "chatguru") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/chatguru"); revalidatePath("/contatos"); return { ok: true, data }; } catch (e) { return fail(e); }
}
const textOf = async (form: FormData) => {
  const f = form.get("file");
  if (!(f instanceof File) || !f.size) throw new Error("Escolha um arquivo .csv.");
  if (f.size > CHATGURU_CSV_MAX_BYTES) throw new Error("O arquivo passa de 10 MB. Exporte por período e envie em partes.");
  return decodeCsv(new Uint8Array(await f.arrayBuffer()));
};
export const previewChatguruCsvAction = async (form: FormData) => run(async () => previewChatguruCsv(await textOf(form)));
export const applyChatguruCsvAction = async (form: FormData) => run(async (u) => applyChatguruCsv(await textOf(form), u));
