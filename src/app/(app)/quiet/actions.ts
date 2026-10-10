"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { endQuiet } from "@/server/domain/quiet";
import { emit } from "@/server/domain/events";

export type QuietResult = { ok: true } | { ok: false; error: string };

/** "Retomar avisos agora": encerra o modo quieto do canal. Só a gestão (sessão revalidada aqui). */
export async function resumeAlertsAction(channelId: string): Promise<QuietResult> {
  try {
    const user = await assertUser("gestor");
    const id = z.string().uuid().parse(channelId);
    await endQuiet(id);
    await db.insert(auditLog).values({ userId: user.id, action: "retomou", entity: "channel", entityId: id, data: { avisos: true } });
    await emit("canal_atualizado", { channelId: id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? "Canal inválido." : e instanceof Error ? e.message : "Não deu para retomar os avisos." };
  }
}
