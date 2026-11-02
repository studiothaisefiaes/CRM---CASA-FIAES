"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { assertCanActOnDeal } from "@/server/domain/deal-scope";
import { executar, planejar, type Feito, type Plano } from "@/server/comando/plano";

/** Comando de voz (dono, 02/11): interpretar só monta o cartão; nada muda até o Confirmar. */
export type ComandoResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function interpretarComandoAction(frase: string): Promise<ComandoResult<Plano>> {
  try {
    const u = await assertPerm("atendimento.ver");
    return { ok: true, data: await planejar(z.string().max(1000).parse(frase), u.id) };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "comando") }; }
}

export async function executarComandoAction(plano: Plano, contactId: string): Promise<ComandoResult<Feito>> {
  try {
    const u = await assertPerm("atendimento.ver");
    const cid = z.string().uuid().parse(contactId);
    const escolhida = plano.candidatas.find((c) => c.contactId === cid);
    if (escolhida?.dealId && plano.acao !== "marcar") await assertCanActOnDeal(u, escolhida.dealId);
    const r = await executar(plano, cid, { id: u.id, perms: u.perms });
    revalidatePath("/atendimento"); revalidatePath("/agenda"); revalidatePath("/");
    return { ok: true, data: r };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "comando") }; }
}
