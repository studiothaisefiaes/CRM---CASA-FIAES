"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveTeam } from "@/server/domain/teams";

type R = { ok: true } | { ok: false; error: string };
const schema = z.object({ id: z.string().uuid().optional(), name: z.string().max(200), active: z.boolean().optional(), memberIds: z.array(z.string().uuid()).max(200) });

/** Cria ou edita um setor e as pessoas dele (Configurações › Pessoas › Setores). Exige "Criar e editar setores" no servidor. */
export async function saveTeamAction(input: unknown): Promise<R> {
  try {
    const u = await assertPerm("setores.gerir");
    await saveTeam(schema.parse(input), u.id);
    revalidatePath("/config/equipe/setores");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "setores") }; }
}
