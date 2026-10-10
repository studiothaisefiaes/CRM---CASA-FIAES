import { db, notify, type Tx } from "../db";
import { dealEvents } from "../db/schema";

export type DealEventType =
  | "lead_criado" | "mensagem_recebida" | "mensagem_enviada" | "resposta" | "etapa_alterada"
  | "campo_alterado" | "responsavel_alterado" | "alerta" | "arquivado" | "restaurado"
  | "assumiu" | "venda" | "comparecimento" | "tarefa" | "lido";

export async function logEvent(tx: Tx | typeof db, dealId: string, type: DealEventType, payload: Record<string, unknown> = {}, userId: string | null = null) {
  await tx.insert(dealEvents).values({ dealId, type, payload, userId });
}

/** Aviso em tempo real para as telas abertas (SSE). Nunca derruba o fluxo principal. */
export async function emit(type: string, data: { dealId?: string; userId?: string | null; [k: string]: unknown } = {}) {
  try { await notify({ type, ...data }); } catch (e) { console.error("[emit] falhou", e); }
}
