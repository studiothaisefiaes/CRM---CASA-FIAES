"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveAiSettings, type AiSettings } from "@/server/ai/settings";
import { saveAiManual } from "@/server/ai/manual";
import { decideLicao } from "@/server/ai/licoes";
import type { ManualSections } from "@/lib/ai-manual";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Liga/desliga a sugestão por IA e muda os limites. Gestão (config.sistema). Nada aqui envia mensagem. */
export async function saveAiSettingsAction(v: AiSettings): Promise<R<AiSettings>> {
  try {
    const u = await assertPerm("config.sistema");
    const data = await saveAiSettings(v, u.id);
    revalidatePath("/config", "layout");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : userErrorMessage(e, "config ia") }; }
}

/** "O que a IA sabe sobre a Casa": o Manual da Casa em seções. Gestão (config.sistema). Entra na próxima sugestão. */
export async function saveAiManualAction(v: ManualSections): Promise<R<{ secoes: ManualSections; updatedAt: string }>> {
  try {
    const u = await assertPerm("config.sistema");
    const r = await saveAiManual(v, u.id);
    revalidatePath("/config/ia");
    return { ok: true, data: { secoes: r.secoes, updatedAt: r.updatedAt.toISOString() } };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config ia manual") }; }
}

/** Lições do Rebater (29/10): "Usar sempre" (com o texto ajustado), "Descartar" ou "Tirar". Gestão (config.sistema). Nada aqui envia mensagem. */
export async function decideLicaoAction(input: { id: string; status: "aprovada" | "descartada"; texto?: string | null }): Promise<R> {
  try {
    const u = await assertPerm("config.sistema");
    await decideLicao(z.string().uuid().parse(input.id), z.enum(["aprovada", "descartada"]).parse(input.status), u.id, z.string().max(300).nullish().parse(input.texto));
    revalidatePath("/config/ia");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config ia licao") }; }
}
