"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveFuncao } from "@/server/domain/funcoes";

type R = { ok: true } | { ok: false; error: string };
/** Liga/desliga, números e textos de uma função (Configurações › Recursos). Exige config.sistema no servidor; `confirmouEnvio` vem do aviso de envio real da tela. */
export async function saveFuncaoAction(key: string, patch: unknown, confirmouEnvio = false): Promise<R> {
  try {
    const u = await assertPerm("config.funcoes");
    await saveFuncao(z.string().min(1).max(80).parse(key), patch, u.id, { confirmouEnvio: confirmouEnvio === true });
    revalidatePath("/config/funcoes");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "funcoes") }; }
}
