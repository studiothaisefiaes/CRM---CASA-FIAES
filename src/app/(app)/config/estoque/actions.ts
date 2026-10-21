"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveEstoqueConfig } from "@/server/domain/estoque/config";

/** Configurações › Estoque (config.sistema): liga/desliga Produtos e estoque e os padrões de um produto novo. O domínio confere a permissão de novo e audita de/para. */
export async function salvarEstoqueConfig(input: { ligado: boolean; cfopPadrao: string; csosnPadrao: string; unidadePadrao: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const u = await assertPerm("config.sistema");
    const c = z.object({ ligado: z.boolean(), cfopPadrao: z.string().max(20), csosnPadrao: z.string().max(20), unidadePadrao: z.string().max(20) }).parse(input);
    await saveEstoqueConfig(c, { id: u.id, perms: u.perms });
    revalidatePath("/config/estoque"); revalidatePath("/servicos"); revalidatePath("/caixa", "layout"); revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "config-estoque", "Não deu certo. Tente de novo.") };
  }
}
