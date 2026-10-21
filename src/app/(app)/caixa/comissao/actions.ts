"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import type { SessionUser } from "@/server/auth/sessions-store";
import { reapplyRules } from "@/server/domain/caixa/commission-reapply";
import { saveCommissionRules, saveProfessionalCommissionRules, setAssistantCommission } from "@/server/domain/caixa/commission-rules";
import type { Perm } from "@/lib/permissions";
import { addAdjustment, cancelAdjustment, saveAdjustmentRule } from "@/server/domain/caixa/adjustments";
import { payableFor, payCommission, undoPayout } from "@/server/domain/caixa/payouts";
import { userErrorMessage } from "@/server/user-error";
import type { CommissionRules, ProCommissionRules } from "@/lib/commission-rules";
import type { ActionResult } from "../actions";

/**
 * Regras da comissão (Fase A, Tarefa 6). Todas pedem `comissao.regras`; `config.sistema` sozinha não basta. O domínio valida os valores.
 * A mudança vale para as comandas fechadas depois: o que já fechou é retrato.
 */
async function run<T>(fn: (u: SessionUser) => Promise<T>, perm: Perm = "comissao.regras", zodMsg = "Confira os valores: use de 0% a 100% e escolha uma das opções."): Promise<ActionResult<T>> {
  try {
    const u = await assertPerm(perm);
    const data = await fn(u);
    revalidatePath("/caixa/comissao");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: zodMsg };
    return { ok: false, error: userErrorMessage(e, "caixa", "Não foi possível salvar. Tente de novo.") };
  }
}

const actorOf = (u: SessionUser) => ({ id: u.id, perms: u.perms });
const mode = z.enum(["nao", "antes", "depois"]);
const bp = z.number().int().min(0).max(10000);
const rules = z.object({
  cartao: mode, antecipacao: mode, antecipacaoBp: bp, custo: mode, doisAssistentes: z.enum(["total", "metade"]), assistenteSaiDaPrincipalBp: bp, divida: z.enum(["agora", "quitacao"]),
});
const proRules = z.object({ cartao: mode.optional(), antecipacao: mode.optional(), custo: mode.optional() }).nullable();

/** "Como calcular a comissão" (as regras da Casa). */
export const saveCommissionRulesAction = async (input: CommissionRules) =>
  run(async (u) => saveCommissionRules(rules.parse(input), actorOf(u)));
/** Regra própria da profissional (`null` = segue a Casa). */
export const saveProCommissionRulesAction = async (professionalId: string, input: ProCommissionRules | null) =>
  run(async (u) => saveProfessionalCommissionRules(z.string().uuid().parse(professionalId), proRules.parse(input), actorOf(u)));
/** % da assistente na linha da principal × serviço (vazio = sem regra). */
export const setAssistantCommissionAction = async (input: { professionalId: string; serviceId: string; bp: number | null }) =>
  run(async (u) => setAssistantCommission(z.object({ professionalId: z.string().uuid(), serviceId: z.string().uuid(), bp: bp.nullable() }).parse(input), actorOf(u)));

/**
 * Vale, bônus e desconto na comissão (Tarefa 8): pedem `comissao.lancar` (só `comissao.pagar` não basta). O domínio recusa com `vales` desligado
 * (cancelar continua possível).
 */
const ADJ_ZOD = "Confira o valor, a data e o motivo.";
const kind = z.enum(["vale", "bonus", "desconto"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const value = z.number().int().min(1).max(100_000_000);
const note = z.string().max(300);
export const addAdjustmentAction = async (input: { professionalId: string; kind: "vale" | "bonus" | "desconto"; valueCents: number; day: string; note: string }) =>
  run(async (u) => addAdjustment(z.object({ professionalId: z.string().uuid(), kind, valueCents: value, day, note }).parse(input), actorOf(u)), "comissao.lancar", ADJ_ZOD);
export const cancelAdjustmentAction = async (id: string, input: { reason: string }) =>
  run(async (u) => cancelAdjustment(z.string().uuid().parse(id), { reason: note.parse(input?.reason ?? "") }, actorOf(u)), "comissao.lancar", ADJ_ZOD);
export const saveAdjustmentRuleAction = async (input: { id?: string | null; professionalId: string; kind: "vale" | "bonus" | "desconto"; valueCents: number; dayOfMonth: number; startsOn: string; endsOn?: string | null; note: string; active: boolean }) =>
  run(async (u) => saveAdjustmentRule(z.object({ id: z.string().uuid().nullish(), professionalId: z.string().uuid(), kind, valueCents: value, dayOfMonth: z.number().int().min(1).max(28), startsOn: day, endsOn: day.nullish(), note, active: z.boolean() }).parse(input), actorOf(u)), "comissao.lancar", ADJ_ZOD);

/**
 * Pagar a comissão (Tarefa 9): pedem `comissao.pagar` (só `comissao.lancar` não basta). O domínio recusa pagar com "Pagar a comissão"
 * desligado; desfazer continua possível.
 */
const PAY_ZOD = "Confira a profissional, a data e o motivo.";
const uuid = z.string().uuid();
export const payableAction = async (professionalId: string, until: string) =>
  run(async () => payableFor({ professionalId: uuid.parse(professionalId), until: day.parse(until) }), "comissao.pagar", PAY_ZOD);
export const payCommissionAction = async (input: { professionalId: string; until: string; expectedNetCents: number; note?: string | null }) =>
  run(async (u) => payCommission(z.object({ professionalId: uuid, until: day, expectedNetCents: z.number().int().min(0).max(1_000_000_000), note: note.nullish() }).parse(input), actorOf(u)), "comissao.pagar", PAY_ZOD);
export const undoPayoutAction = async (id: string, input: { reason: string }) =>
  run(async (u) => undoPayout(uuid.parse(id), { reason: note.parse(input?.reason ?? "") }, actorOf(u)), "comissao.pagar", PAY_ZOD);

/**
 * Aplicar a regra de hoje às comandas já fechadas do período (psico r68 #19). A prévia roda tudo e desfaz; confirmar grava. Pede `comissao.regras`.
 * Itens já pagos em recibo ou retidos pela dívida ficam como estão.
 */
const REAPPLY_ZOD = "Confira o período.";
const reapplyInput = z.object({ from: day, to: day, professionalId: z.string().uuid().nullish() });
export const previewReapplyAction = async (input: { from: string; to: string; professionalId?: string | null }) =>
  run(async (u) => { const i = reapplyInput.parse(input); return reapplyRules(i, { dryRun: true, professionalId: i.professionalId }, actorOf(u)); }, "comissao.regras", REAPPLY_ZOD);
export const applyReapplyAction = async (input: { from: string; to: string; professionalId?: string | null }) =>
  run(async (u) => { const i = reapplyInput.parse(input); return reapplyRules(i, { dryRun: false, professionalId: i.professionalId }, actorOf(u)); }, "comissao.regras", REAPPLY_ZOD);
