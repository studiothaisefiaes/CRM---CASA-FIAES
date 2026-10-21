"use server";
import { revalidatePath } from "next/cache";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { saveCasaInfo, saveClientLinkSettings } from "@/server/domain/client-link/settings";
import { userErrorMessage } from "@/server/user-error";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/pagina-cliente"); return { ok: true, data }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "config") }; }
}

export const saveCasaInfoAction = async (v: unknown) => run((u) => saveCasaInfo(v, u));
export const saveClientLinkSettingsAction = async (v: unknown) => run((u) => saveClientLinkSettings(v, u));
