"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { decideLeave } from "@/server/domain/pro/leave";
import { userErrorMessage } from "@/server/user-error";
import { getEntryExtras, type EntryExtras } from "@/server/queries/entry-extras";
import { addClientNote } from "@/server/domain/client-notes";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Aprovar ou recusar um pedido de folga (aprovar segue o modo da agenda). */
export async function decideLeaveAction(blockId: string, decision: string, note: string): Promise<ActionResult<{ clients: string[] }>> {
  try {
    const user = await assertPerm("agenda.marcar");
    const r = await decideLeave(z.string().uuid().parse(blockId), z.enum(["aprovar", "recusar"]).parse(decision), z.string().max(400).parse(note), user.id);
    revalidatePath("/agenda");
    return { ok: true, data: r };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "folga", "Não deu para responder o pedido. Tente de novo.") }; }
}

/** O que o card do horário mostra a mais: "Finalizado por Ana" e a ficha técnica. */
export async function entryExtrasAction(appointmentId: string): Promise<ActionResult<EntryExtras>> {
  try {
    await assertPerm("atendimento.ver");
    return { ok: true, data: await getEntryExtras(z.string().uuid().parse(appointmentId)) };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não deu para carregar.") }; }
}

/** "Anotar para a profissional": vai para a ficha técnica e ela vê na próxima cliente. */
export async function addNoteForProAction(appointmentId: string, body: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await addClientNote({ appointmentId: z.string().uuid().parse(appointmentId), body: z.string().max(4000).parse(body) }, { userId: user.id, professionalId: null });
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não deu para salvar a anotação.") }; }
}
