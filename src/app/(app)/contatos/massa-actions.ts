"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { CAMPAIGN_MAX_RECIPIENTS, cancelCampaign, confirmCampaign, createCampaign, pauseCampaign, previewAudience, resumeCampaign, type AudiencePreview } from "@/server/domain/campaigns";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
export type AudienceInput = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "massa") });
const uuid = z.string().uuid();
const audienceSchema = z.object({
  q: z.string().max(80).nullish(), onlyClients: z.boolean().optional(), tag: z.string().max(30).nullish(),
  contactIds: z.array(uuid).max(CAMPAIGN_MAX_RECIPIENTS + 1).optional(),
});

export async function previewAudienceAction(a: AudienceInput): Promise<R<AudiencePreview>> {
  try { await assertPerm("mensagem.massa"); return { ok: true, data: await previewAudience(audienceSchema.parse(a)) }; } catch (e) { return fail(e); }
}
export async function createCampaignAction(input: { name: string; body: string; audience: AudienceInput; intervalSeconds: number }): Promise<R<{ id: string; total: number }>> {
  try {
    const user = await assertPerm("mensagem.massa");
    const data = await createCampaign({ name: z.string().max(80).parse(input.name), body: z.string().max(2000).parse(input.body), audience: audienceSchema.parse(input.audience), intervalSeconds: z.number().int().parse(input.intervalSeconds) }, user);
    return { ok: true, data };
  } catch (e) { return fail(e); }
}
export async function confirmCampaignAction(id: string, input: { typedTotal: number; acceptRisk: boolean; startAt?: string | null }): Promise<R<{ startAt: string; endsAround: string }>> {
  try {
    const user = await assertPerm("mensagem.massa");
    const r = await confirmCampaign(uuid.parse(id), { typedTotal: z.number().int().parse(input.typedTotal), acceptRisk: z.boolean().parse(input.acceptRisk), startAt: input.startAt ? new Date(input.startAt) : null }, user);
    revalidatePath("/config/massa");
    return { ok: true, data: { startAt: r.startAt.toISOString(), endsAround: r.endsAround.toISOString() } };
  } catch (e) { return fail(e); }
}
export async function pauseCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await pauseCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function resumeCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await resumeCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function cancelCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await cancelCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
