"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { criarChave, ESCOPOS, revogarChave } from "@/server/api/chaves";

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const novaInput = z.object({
  nome: z.string().trim().min(1, "Dê um nome para a chave.").max(80, "Use até 80 caracteres no nome."),
  /** Vazio = em nome de quem cria (o padrão). Outra pessoa: só a Gestão, sem dar permissão que ela não tem (criarChave confere). */
  userId: z.string().uuid("Escolha em nome de quem a chave age.").nullish(),
  escopos: z.array(z.enum(ESCOPOS)).min(1, "Escolha pelo menos uma coisa que a chave pode fazer."),
  /** Último dia em que a chave vale (AAAA-MM-DD, em Salvador). Vazio = não vence. */
  validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de validade inválida.").nullish(),
});

/**
 * Configurações › API: cria a chave e devolve o segredo UMA vez (a tela mostra com o botão Copiar; o banco guarda só o hash).
 * Só quem tem api.gerir. Por padrão a chave é de quem cria; em nome de outra pessoa, só a Gestão (regras em criarChave). A validade vale
 * até o fim do dia escolhido em Salvador.
 */
export async function createApiKeyAction(input: z.input<typeof novaInput>): Promise<ActionResult<{ chave: string; prefixo: string }>> {
  try {
    const u = await assertPerm("api.gerir");
    const v = novaInput.parse(input);
    const expiraEm = v.validade ? new Date(new Date(`${v.validade}T00:00:00-03:00`).getTime() + 86_400_000) : null;
    const r = await criarChave({ nome: v.nome, userId: v.userId ?? u.id, escopos: v.escopos, expiraEm }, u.id);
    revalidatePath("/config/api");
    return { ok: true, data: { chave: r.chave, prefixo: r.prefixo } };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config api", "Não foi possível criar a chave. Tente de novo.") }; }
}

/** Revoga: a chave para de funcionar na hora (fica na lista como Revogada, para a auditoria). Só quem tem api.gerir. */
export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  try {
    const u = await assertPerm("api.gerir");
    await revogarChave(z.string().uuid().parse(id), u.id);
    revalidatePath("/config/api");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config api", "Não foi possível revogar a chave. Tente de novo.") }; }
}
