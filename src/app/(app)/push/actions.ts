"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pushSubscriptions } from "@/server/db/schema";
import { isAllowedPushEndpoint } from "@/server/push-endpoint";
import { userErrorMessage } from "@/server/user-error";

export type PushResult = { ok: true } | { ok: false; error: string };

const subscription = z.object({
  endpoint: z.string().url().max(2000).refine(isAllowedPushEndpoint, "Endereço de push não aceito."),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

/** Guarda a inscrição deste aparelho. O endpoint é único: o mesmo aparelho pode trocar de usuário. */
export async function savePushSubscriptionAction(input: z.input<typeof subscription>): Promise<PushResult> {
  try {
    const user = await assertUser();
    const s = subscription.parse(input);
    await db.insert(pushSubscriptions).values({ userId: user.id, ...s })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: s.p256dh, auth: s.auth, lastOkAt: null } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "push", "Não deu para ativar os avisos.") };
  }
}

/** Remove a inscrição deste aparelho (só a do próprio usuário). */
export async function removePushSubscriptionAction(endpoint: string): Promise<PushResult> {
  try {
    const user = await assertUser();
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, z.string().url().max(2000).parse(endpoint)), eq(pushSubscriptions.userId, user.id)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "push", "Não deu para desativar os avisos.") };
  }
}
