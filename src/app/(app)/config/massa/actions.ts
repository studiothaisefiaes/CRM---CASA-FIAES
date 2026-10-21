"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveMassSettings } from "@/server/domain/campaigns";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "massa") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/massa"); revalidatePath("/contatos"); return { ok: true, data }; } catch (e) { return fail(e); }
}
export const saveMassSettingsAction = async (v: { enabled: boolean }) => run((u) => saveMassSettings({ enabled: z.boolean().parse(v.enabled) }, u));
