"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveAfterVisit } from "@/server/domain/after-visit";

type R = { ok: true } | { ok: false; error: string };
/**
 * Depois do atendimento (Fase B): números, textos e desligar. Exige config.sistema no servidor; ligar é pela Virada (Task 10) e salvar
 * ligado (modo diferente de Nada) também exige `virada.fazer`.
 */
export async function saveAfterVisitAction(v: unknown): Promise<R> {
  try {
    const u = await assertPerm("config.sistema");
    const mode = v && typeof v === "object" ? (v as { mode?: unknown }).mode : undefined;
    if (mode !== "desligado") await assertPerm("virada.fazer");
    await saveAfterVisit(v, u.id);
    revalidatePath("/config/depois-atendimento");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "depois-atendimento") }; }
}
