"use server";
import { revalidatePath } from "next/cache";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { saveOnlineBooking } from "@/server/domain/client-link/settings";
import { userErrorMessage } from "@/server/user-error";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/agendamento-online"); return { ok: true, data }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "agendamento-online") }; }
}

export const saveOnlineBookingAction = async (v: unknown) => run((u) => saveOnlineBooking(v, u));
