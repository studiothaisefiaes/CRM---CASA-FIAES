"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { setAutomationsPaused } from "@/server/domain/consent";
import { tomorrowStartBahia } from "@/lib/consent";

type R = { ok: true } | { ok: false; error: string };
const schema = z.object({ contactId: z.string().uuid(), until: z.enum(["sempre", "amanha"]).nullable() });

/** "Pausar automáticas desta cliente": "amanha" vale até 00:00 de Salvador; "sempre" até alguém religar; null religa. Exige "Pausar as automáticas de uma cliente". */
export async function pauseAutomationsAction(contactId: string, until: "sempre" | "amanha" | null): Promise<R> {
  try {
    const u = await assertPerm("atendimento.pausar");
    const p = schema.parse({ contactId, until });
    await setAutomationsPaused(p.contactId, p.until === "amanha" ? tomorrowStartBahia(new Date()) : p.until, u.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "pausa") }; }
}
