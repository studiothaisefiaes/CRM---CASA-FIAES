"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { assertUser } from "@/server/auth/session";
import { moveDeal } from "@/server/domain/deals";
import { updateDeal, createManualLead, type DealPatch } from "@/server/domain/updates";
import { sendFromCrm } from "@/server/domain/send";
import { db } from "@/server/db";
import { alerts } from "@/server/db/schema";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues[0]?.message ?? "Dados inválidos" : e instanceof Error ? e.message : "Algo deu errado. Tente de novo." });

export async function moveDealAction(dealId: string, stageKey: string, extra?: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertUser();
    z.string().uuid().parse(dealId);
    if (extra && Object.keys(extra).length) await updateDeal(dealId, extra, user.id);
    await moveDeal(dealId, stageKey, user.id, "manual");
    revalidatePath("/funil"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function updateDealAction(dealId: string, patch: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertUser();
    await updateDeal(z.string().uuid().parse(dealId), patch, user.id);
    revalidatePath("/funil");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function sendMessageAction(dealId: string, text: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    await sendFromCrm(z.string().uuid().parse(dealId), text, user.id);
    revalidatePath("/funil"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function createLeadAction(form: { phone: string; name?: string }): Promise<ActionResult<{ dealId: string }>> {
  try {
    const user = await assertUser();
    const dealId = await createManualLead(form, user.id);
    revalidatePath("/funil");
    return { ok: true, data: { dealId } };
  } catch (e) { return fail(e); }
}

export async function markAlertsReadAction(ids?: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const now = new Date();
    if (ids?.length) for (const id of ids) await db.update(alerts).set({ readAt: now }).where(and(eq(alerts.id, id), isNull(alerts.readAt)));
    else await db.update(alerts).set({ readAt: now }).where(and(eq(alerts.userId, user.id), isNull(alerts.readAt)));
    return { ok: true };
  } catch (e) { return fail(e); }
}
