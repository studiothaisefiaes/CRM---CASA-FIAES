"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveAppointmentLabel, saveVisitTypes, type VisitTypesPatch } from "@/server/domain/agenda/labels";

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Cria ou edita um marcador do horário (nome, cor, em uso). Só quem tem config.marcadores. Nada aqui envia mensagem. */
export async function saveAppointmentLabelAction(input: { id?: string; name: string; color?: string | null; active?: boolean }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await assertPerm("config.marcadores");
    const data = await saveAppointmentLabel(input, u.id);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config marcadores", "Não foi possível salvar o marcador. Tente de novo.") }; }
}

/** Renomeia e/ou tira de uso Indicação e Noiva (rótulo vazio = o texto sugerido). Só quem tem config.marcadores. */
export async function saveVisitTypesAction(patch: VisitTypesPatch): Promise<ActionResult> {
  try {
    const u = await assertPerm("config.marcadores");
    await saveVisitTypes(patch, u.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config marcadores", "Não foi possível salvar os tipos. Tente de novo.") }; }
}
