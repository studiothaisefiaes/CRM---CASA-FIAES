"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { auditLog, channels } from "@/server/db/schema";
import { endQuiet } from "@/server/domain/quiet";
import { emit } from "@/server/domain/events";

export type QuietResult = { ok: true } | { ok: false; error: string };

/** "Retomar avisos agora": encerra o modo quieto do canal. Só a gestão (sessão revalidada aqui). */
export async function resumeAlertsAction(channelId: string): Promise<QuietResult> {
  try {
    const user = await assertUser("gestor");
    const id = z.string().uuid().parse(channelId);
    const [ch] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id));
    if (!ch) return { ok: false, error: "Esse número não existe mais." };
    await endQuiet(id);
    await db.insert(auditLog).values({ userId: user.id, action: "retomou", entity: "channel", entityId: id, data: { avisos: true } });
    await emit("canal_atualizado", { channelId: id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "Número inválido." };
    // Só a mensagem de sessão/permissão vem do assertUser; qualquer outro erro vai para o log, não para a tela.
    if (e instanceof Error && /sessão expirou|só a gestão/i.test(e.message)) return { ok: false, error: e.message };
    console.error("[quiet] retomar avisos falhou", e);
    return { ok: false, error: "Não deu para retomar os avisos. Tente de novo." };
  }
}
