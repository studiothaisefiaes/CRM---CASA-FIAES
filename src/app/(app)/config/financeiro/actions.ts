"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveFinanceiroConfig } from "@/server/domain/financeiro/config";

/** Configurações › Financeiro (config.sistema): liga/desliga e os números de regra. O domínio confere a permissão de novo e audita de/para. */
export async function salvarFinanceiroConfig(input: { contasAPagar: boolean; resultado: boolean; venceEmDias: number; repetirMaxMeses: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const u = await assertPerm("config.sistema");
    const c = z.object({ contasAPagar: z.boolean(), resultado: z.boolean(), venceEmDias: z.number(), repetirMaxMeses: z.number() }).parse(input);
    await saveFinanceiroConfig(c, { id: u.id, perms: u.perms });
    revalidatePath("/config/financeiro"); revalidatePath("/relatorios");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "config-financeiro", "Não deu certo. Tente de novo.") };
  }
}
