"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveClientAlertConfig, type ClientAlertPatch } from "@/server/domain/client-alert";

type ActionResult = { ok: true } | { ok: false; error: string };

/** Onde o Aviso da cliente salta e o texto de quem não autorizou uso de imagem (texto vazio = o sugerido). Só quem tem config.aviso_cliente. */
export async function saveClientAlertAction(patch: ClientAlertPatch): Promise<ActionResult> {
  try {
    const u = await assertPerm("config.aviso_cliente");
    await saveClientAlertConfig(patch, u.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config aviso da cliente", "Não foi possível salvar. Tente de novo.") }; }
}
