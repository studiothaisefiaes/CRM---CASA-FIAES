"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { assertUser } from "@/server/auth/session";
import { moveDeal } from "@/server/domain/deals";
import { updateDeal, createManualLead, type DealPatch } from "@/server/domain/updates";
import { MAX_MEDIA_BYTES, markConversationRead, sendFromCrm, sendMediaFromCrm } from "@/server/domain/send";
import { db } from "@/server/db";
import { alerts, deals } from "@/server/db/schema";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues[0]?.message ?? "Dados inválidos" : e instanceof Error ? e.message : "Algo deu errado. Tente de novo." });

export async function moveDealAction(dealId: string, stageKey: string, extra?: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertUser();
    z.string().uuid().parse(dealId);
    if (extra && Object.keys(extra).length) await updateDeal(dealId, extra, user.id);
    await moveDeal(dealId, z.string().min(1).max(40).parse(stageKey), user.id, "manual");
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function updateDealAction(dealId: string, patch: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertUser();
    if (patch.ownerId !== undefined && user.role !== "gestor") throw new Error("Só a gestão troca o responsável pelo lead.");
    await updateDeal(z.string().uuid().parse(dealId), patch, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

const waited = async (id: string) => {
  const [before] = await db.select({ since: deals.awaitingReplySince }).from(deals).where(eq(deals.id, id));
  return before?.since ? Math.round((Date.now() - before.since.getTime()) / 1000) : null;
};

export async function sendMessageAction(dealId: string, text: string, quoteMessageId?: string | null): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertUser();
    const id = z.string().uuid().parse(dealId);
    const quote = z.string().uuid().nullish().parse(quoteMessageId);
    const waitedSeconds = await waited(id);
    await sendFromCrm(id, text, user.id, { quoteMessageId: quote });
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** Foto, PDF ou áudio (FormData: dealId, file, caption?, quoteMessageId?). Até 16 MB; o tipo é conferido pelos bytes no servidor. */
export async function sendMediaAction(form: FormData): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertUser();
    const id = z.string().uuid().parse(form.get("dealId"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Escolha um arquivo para enviar.");
    if (file.size > MAX_MEDIA_BYTES) throw new Error("O arquivo passa de 16 MB. Escolha um menor.");
    const caption = z.string().max(1000, "Legenda muito longa (máximo 1.000 caracteres).").nullish().parse(form.get("caption"));
    const quote = z.string().uuid().nullish().parse(form.get("quoteMessageId") || null);
    const waitedSeconds = await waited(id);
    await sendMediaFromCrm(id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, caption ?? null, user.id, { quoteMessageId: quote });
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** Chamada ao abrir a conversa. Não espera a Evolution: o visto azul nunca atrasa nem derruba a tela. */
export async function markConversationReadAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    void markConversationRead(z.string().uuid().parse(dealId), user.id);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function createLeadAction(form: { phone: string; name?: string }): Promise<ActionResult<{ dealId: string }>> {
  try {
    const user = await assertUser();
    const dealId = await createManualLead(form, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true, data: { dealId } };
  } catch (e) { return fail(e); }
}

export async function markAlertsReadAction(ids?: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const now = new Date();
    const mine = user.role === "gestor" ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id);
    const valid = z.array(z.string().uuid()).max(500).parse(ids ?? []);
    await db.update(alerts).set({ readAt: now }).where(and(mine, isNull(alerts.readAt), valid.length ? inArray(alerts.id, valid) : undefined));
    return { ok: true };
  } catch (e) { return fail(e); }
}
