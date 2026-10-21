"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveWelcomeMenu } from "@/server/domain/welcome-menu";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : userErrorMessage(e, "menu") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/menu"); return { ok: true, data }; } catch (e) { return fail(e); }
}
export const saveWelcomeMenuAction = async (v: unknown) => run((u) => saveWelcomeMenu(v, u));
