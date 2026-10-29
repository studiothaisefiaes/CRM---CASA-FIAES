"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { assertCanActOnDeal } from "@/server/domain/deal-scope";
import { orcamentoFotos, orcamentoOpcoes, renderOrcamento, sendOrcamento } from "@/server/domain/orcamento";
import { orcamentoSchema, type OrcamentoInput } from "@/lib/orcamento";

/** Orçamento do Método em PDF (Cati 27/10). Ver gera o PDF sem enviar; Enviar manda como documento na conversa, só no toque da atendente. */
type R<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "orçamento em PDF") });

export async function orcamentoDadosAction(dealId: string): Promise<R<{ fotos: Awaited<ReturnType<typeof orcamentoFotos>>; opcoes: Awaited<ReturnType<typeof orcamentoOpcoes>> }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = z.string().uuid().parse(dealId);
    await assertCanActOnDeal(user, id);
    const [fotos, opcoes] = await Promise.all([orcamentoFotos(id), orcamentoOpcoes()]);
    return { ok: true, data: { fotos, opcoes } };
  } catch (e) { return fail(e); }
}

export async function orcamentoVerAction(input: OrcamentoInput): Promise<R<{ base64: string; fileName: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, orcamentoSchema.parse(input).dealId);
    const r = await renderOrcamento(input, user.id);
    return { ok: true, data: { base64: r.pdf.toString("base64"), fileName: r.fileName } };
  } catch (e) { return fail(e); }
}

export async function orcamentoEnviarAction(input: OrcamentoInput, legenda: string | null): Promise<R<null>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, orcamentoSchema.parse(input).dealId);
    await sendOrcamento(input, z.string().max(900).nullish().parse(legenda) ?? null, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}
