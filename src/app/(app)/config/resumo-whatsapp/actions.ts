"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveSummaryWhatsapp } from "@/server/domain/summary-whatsapp";

type R = { ok: true; descartadas: number } | { ok: false; error: string };
/** Resumo do dia no WhatsApp (Fase B): liga/desliga, quem recebe, hora e limites. Exige config.sistema no servidor; `confirmouEnvio` vem do aviso de envio real da tela. */
export async function saveSummaryWhatsappAction(v: unknown, confirmouEnvio = false): Promise<R> {
  try {
    const u = await assertPerm("config.sistema");
    const r = await saveSummaryWhatsapp(v, u.id, { confirmouEnvio: confirmouEnvio === true });
    revalidatePath("/config/resumo-whatsapp");
    return { ok: true, descartadas: r?.descartadas ?? 0 };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "resumo-whatsapp") }; }
}
