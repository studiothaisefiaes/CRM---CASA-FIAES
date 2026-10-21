"use server";
import { z } from "zod";
import { assertAnyPerm, assertPerm } from "@/server/auth/session";
import { getDealSheetData, type SheetDeal } from "@/server/queries/deal";
import { assertCanActOnDeal, OUT_OF_SCOPE } from "@/server/domain/deal-scope";
import { CONVERSATION_ERROR, conversationFor, nextWaitingFor, type ConversationResult, type NextWaitingResult, type Viewer } from "@/server/queries/conversation";

const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo.";
/** Texto fixo para a tela: nunca o `message` cru do erro nem o JSON do zod. */
const failure = (e: unknown, fallback: string) => (e instanceof Error && (e.message === SESSION_EXPIRED || e.message === OUT_OF_SCOPE) ? e.message : fallback);

export type { Viewer, ConversationResult } from "@/server/queries/conversation";

/** A conversa e os dados do lead aberto na Fila. O painel usa a rota GET /api/conversa/[id] (fora da fila das Server Actions); esta fica para quem chama por action. */
export async function getConversationAction(dealId: string): Promise<ConversationResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    return await conversationFor(user, z.string().uuid().parse(dealId));
  } catch (e) { return { ok: false, error: failure(e, CONVERSATION_ERROR) }; }
}

export type SheetResult = { ok: true; data: SheetDeal; viewer: Viewer } | { ok: false; error: string };

/** Só o que as folhas de agendar, fechar venda e perdido pedem (Quadro: soltar um card nessas colunas). Sem conversa: abre bem mais rápido que `getConversationAction`. */
export async function getDealForSheet(dealId: string): Promise<SheetResult> {
  try {
    const user = await assertAnyPerm("atendimento.ver", "quadro.ver");
    const id = z.string().uuid().parse(dealId);
    await assertCanActOnDeal(user, id);
    const data = await getDealSheetData(id);
    if (!data) return { ok: false, error: "Essa conversa não existe mais." };
    return { ok: true, data, viewer: { id: user.id, perms: user.perms } };
  } catch (e) { return { ok: false, error: failure(e, "Não foi possível abrir a conversa. Tente de novo.") }; }
}

/** Quem espera há mais tempo, sem o lead atual: destino do "Próximo da fila". O painel usa GET /api/conversa/[id]/proximo. */
export async function nextWaitingAction(dealId: string): Promise<NextWaitingResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    return await nextWaitingFor(user, z.string().uuid().parse(dealId));
  } catch (e) { return { ok: false, error: failure(e, "Não foi possível buscar o próximo da fila.") }; }
}
