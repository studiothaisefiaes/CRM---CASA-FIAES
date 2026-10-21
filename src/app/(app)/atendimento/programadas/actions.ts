"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { editScheduled } from "@/server/domain/retomada";
import { cancelScheduled, restoreScheduled } from "@/server/domain/scheduled";
import { UserFacingError } from "@/server/domain/errors";
import { canTouchScheduled } from "@/server/queries/scheduled-list";

/** Mensagens programadas: Editar (vira a retomada nova), Cancelar e o Desfazer do Cancelar. Só no escopo de quem pede. */
export type ProgResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "mensagem programada") });
const uuid = z.string().uuid();
const NOT_YOURS = "Essa mensagem não está mais na sua lista.";
const done = () => { revalidatePath("/atendimento/programadas"); revalidatePath("/atendimento"); revalidatePath("/"); };

/** Só as do escopo dela (o mesmo da lista). */
async function mine(user: Awaited<ReturnType<typeof assertPerm>>, outboxId: string) {
  const id = uuid.parse(outboxId);
  if (!(await canTouchScheduled(user, id))) throw new UserFacingError(NOT_YOURS);
  return id;
}

const editInput = z.object({ dueAt: z.string().min(10).max(40), motivo: z.string().max(120).nullish(), texto: z.string().max(4000).nullish(), cancelIfReply: z.boolean().optional() });

export async function editScheduledAction(outboxId: string, input: z.input<typeof editInput>): Promise<ProgResult<{ dueAt: string; texto: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = await mine(user, outboxId);
    const v = editInput.parse(input);
    const r = await editScheduled(id, { dueAt: new Date(v.dueAt), motivo: v.motivo, texto: v.texto, cancelIfReply: v.cancelIfReply }, user.id);
    done();
    return { ok: true, data: { dueAt: r.dueAt.toISOString(), texto: !!r.outboxId } };
  } catch (e) { return fail(e); }
}

export async function cancelScheduledAction(outboxId: string): Promise<ProgResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = await mine(user, outboxId);
    await cancelScheduled(id, user.id, "Cancelada em Mensagens programadas.");
    done();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function restoreScheduledAction(outboxId: string): Promise<ProgResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = await mine(user, outboxId);
    await restoreScheduled(id, user.id);
    done();
    return { ok: true };
  } catch (e) { return fail(e); }
}
