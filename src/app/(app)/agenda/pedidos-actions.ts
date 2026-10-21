"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { decideOnlineRequest } from "@/server/domain/client-link/online";
import { userErrorMessage } from "@/server/user-error";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Confirmar ou recusar um pedido do site (confirmar segue o modo da agenda e avisa a profissional). */
export async function decideOnlineRequestAction(visitId: string, decision: string, motivo?: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("agenda.marcar");
    await decideOnlineRequest(z.string().uuid().parse(visitId), z.enum(["confirmar", "recusar"]).parse(decision), user.id, new Date(), z.string().max(1000).optional().parse(motivo));
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "pedido-site", "Não deu para responder o pedido. Tente de novo.") }; }
}
