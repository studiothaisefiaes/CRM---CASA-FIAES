"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { proOf } from "@/server/auth/pro-session";
import { lerEscolhaFalta } from "@/server/domain/falta-escolha";
import { proAct, proAddExtras, proUndoNoShow } from "@/server/domain/pro/appointment-actions";
import { addClientNote } from "@/server/domain/client-notes";
import { markNotificationsRead, sendTestPush } from "@/server/domain/pro/notifications";
import type { ComandaFeed } from "@/server/domain/pro/comanda-bridge";
import { userErrorMessage } from "@/server/user-error";
import { ackDay } from "@/server/domain/pro/acks";
import { requestLeave } from "@/server/domain/pro/leave";

export type ProResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown, fallback: string): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "app-profissional", fallback) });

/** Chegou, Iniciar, Finalizar e Faltou num horário dela (a posse é conferida dentro da porta do 6B). */
export async function proActAction(appointmentId: string, action: string): Promise<ProResult<{ comanda: ComandaFeed }>> {
  try {
    const user = await assertPerm("pro.app");
    const pro = await proOf(user);
    const act = z.enum(["chegou", "iniciar", "finalizar", "faltou"]).parse(action);
    const r = await proAct(pro, z.string().uuid().parse(appointmentId), act, new Date(), act === "faltou" ? await lerEscolhaFalta() : null);
    revalidatePath("/pro", "layout");
    return { ok: true, data: { comanda: r.comanda } };
  } catch (e) { return fail(e, "Não deu para registrar. Tente de novo."); }
}

/** Desfazer o Faltou dela (QA r58, M-2). */
export async function proUndoNoShowAction(appointmentId: string): Promise<ProResult> {
  try {
    const user = await assertPerm("pro.app");
    const pro = await proOf(user);
    await proUndoNoShow(pro, z.string().uuid().parse(appointmentId));
    revalidatePath("/pro", "layout");
    return { ok: true };
  } catch (e) { return fail(e, "Não deu para desfazer. Avise a recepção."); }
}

/** "Fez algo a mais?": serviços dela na comanda da visita (só com o caixa no CRM). */
export async function proExtrasAction(appointmentId: string, serviceIds: string[]): Promise<ProResult<{ comanda: ComandaFeed }>> {
  try {
    const user = await assertPerm("pro.app");
    const pro = await proOf(user);
    const comanda = await proAddExtras(pro, z.string().uuid().parse(appointmentId), z.array(z.string().uuid()).max(10).parse(serviceIds));
    revalidatePath("/pro", "layout");
    return { ok: true, data: { comanda } };
  } catch (e) { return fail(e, "Não deu para acrescentar. Avise a recepção."); }
}

/** Anotar (texto e foto opcional) na ficha da cliente de um horário dela. */
export async function proNoteAction(form: FormData): Promise<ProResult> {
  try {
    const user = await assertPerm("pro.app");
    const pro = await proOf(user);
    const file = form.get("photo");
    await addClientNote({
      appointmentId: z.string().uuid().parse(form.get("appointmentId")),
      body: z.string().max(4000).parse(form.get("body") ?? ""),
      photo: file instanceof File && file.size ? { data: Buffer.from(await file.arrayBuffer()) } : null,
    }, { userId: pro.userId, professionalId: pro.professionalId });
    revalidatePath("/pro", "layout");
    return { ok: true };
  } catch (e) { return fail(e, "Não deu para salvar a anotação. Tente de novo."); }
}

/** Abrir Avisos marca os avisos dela como lidos. */
export async function markNotificationsReadAction(): Promise<ProResult> {
  try {
    const user = await assertPerm("pro.app");
    await markNotificationsRead(await proOf(user));
    revalidatePath("/pro", "layout");
    return { ok: true };
  } catch (e) { return fail(e, "Não deu para marcar como lidos."); }
}

/** O aviso de teste do passo a passo (sai na hora para os aparelhos dela). */
export async function sendTestPushAction(): Promise<ProResult<{ sent: number; devices: number }>> {
  try {
    const user = await assertPerm("pro.app");
    await proOf(user);
    return { ok: true, data: await sendTestPush(user.id) };
  } catch (e) { return fail(e, "Não deu para mandar o aviso de teste."); }
}

const leaveSchema = z.object({
  startsOn: z.string().max(10), endsOn: z.string().max(10), allDay: z.boolean(), startTime: z.string().max(5), endTime: z.string().max(5), reason: z.string().max(20), note: z.string().max(400),
});

/** Pedir folga ou bloqueio: fica "Aguardando a recepção". */
export async function requestLeaveAction(input: z.input<typeof leaveSchema>): Promise<ProResult> {
  try {
    const user = await assertPerm("pro.app");
    await requestLeave(await proOf(user), leaveSchema.parse(input));
    revalidatePath("/pro", "layout");
    return { ok: true };
  } catch (e) { return fail(e, "Não deu para pedir. Tente de novo."); }
}

/** "Vi minha agenda de amanhã". */
export async function ackDayAction(day: string): Promise<ProResult> {
  try {
    const user = await assertPerm("pro.app");
    await ackDay(await proOf(user), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day));
    revalidatePath("/pro", "layout");
    return { ok: true };
  } catch (e) { return fail(e, "Não deu para registrar. Tente de novo."); }
}
