"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import type { Perm } from "@/lib/permissions";
import { inviteProfessional, regenerateProInvite, revokeProAccess } from "@/server/domain/pro/access";
import { userErrorMessage } from "@/server/user-error";
import { saveProAppSettings } from "@/server/domain/pro/settings";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "equipe.gerir"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/profissionais"); return { ok: true, data }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "acesso-profissional") }; }
}
const link = (r: { url: string; text: string }) => ({ url: r.url, text: r.text });

export const inviteProAction = async (professionalId: string, email: string) =>
  run((u) => inviteProfessional(z.string().uuid().parse(professionalId), z.string().max(200).parse(email), u).then(link));
export const regenerateProInviteAction = async (professionalId: string) =>
  run((u) => regenerateProInvite(z.string().uuid().parse(professionalId), u).then(link));
export const revokeProAccessAction = async (professionalId: string) =>
  run((u) => revokeProAccess(z.string().uuid().parse(professionalId), u));
export const saveProAppSettingsAction = async (v: unknown) => run((u) => saveProAppSettings(v, u), "config.sistema");
