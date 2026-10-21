"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveRoboConfig } from "@/server/domain/avec/robo/settings";

type R = { ok: true } | { ok: false; error: string };

/** Liga/desliga o robô do Avec e escolhe a hora (Salvador). Exige `config.sistema`. */
export async function saveAvecRoboAction(input: unknown): Promise<R> {
  try {
    const u = await assertPerm("config.sistema");
    await saveRoboConfig(z.object({ ativo: z.boolean(), hora: z.number().int().min(0).max(23) }).parse(input), u.id);
    revalidatePath("/config/avec");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "avec-robo") }; }
}
