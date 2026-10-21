"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveRelatoriosConfig } from "@/server/domain/relatorios-config";

/** Configurações › Relatórios (config.sistema): liga/desliga o que os Relatórios mostram. O domínio confere a permissão de novo e audita de/para. */
export async function salvarRelatoriosConfig(input: { ocupacao: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const u = await assertPerm("config.sistema");
    const c = z.object({ ocupacao: z.boolean() }).parse(input);
    await saveRelatoriosConfig(c, { id: u.id, perms: u.perms });
    revalidatePath("/config/relatorios"); revalidatePath("/relatorios");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "config-relatorios", "Não deu certo. Tente de novo.") };
  }
}
