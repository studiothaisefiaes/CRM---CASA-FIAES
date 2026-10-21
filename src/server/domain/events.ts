import { db, notify, type Tx } from "../db";
import { dealEvents } from "../db/schema";
import { scopesOf } from "@/lib/live-scope";

export type DealEventType =
  | "lead_criado" | "mensagem_recebida" | "mensagem_enviada" | "resposta" | "etapa_alterada"
  | "campo_alterado" | "responsavel_alterado" | "alerta" | "arquivado" | "restaurado"
  | "assumiu" | "venda" | "comparecimento" | "tarefa" | "lido"
  | "distribuido" | "oferecido" | "devolvido_a_fila" | "conversa_arquivada" | "conversa_desarquivada" | "espera_virou_followup" | "espera_encerrada_agradecimento" | "retomar_depois" | "contato_mesclado" | "aguardando_cliente" | "orcamento_enviado" | "tentativa" | "espera_vencida" | "tentativas_paradas" | "retomada" | "retomada_cancelada" | "nova_organizacao"
  | "mensagem_agendada" | "agendada_cancelada" | "resolvida" | "resolvida_desfeita" | "convite_retorno" | "link_cliente" | "falta_marcada" | "falta_desfeita" | "passado_para_setor";

export async function logEvent(tx: Tx | typeof db, dealId: string, type: DealEventType, payload: Record<string, unknown> = {}, userId: string | null = null) {
  await tx.insert(dealEvents).values({ dealId, type, payload, userId });
}

/**
 * Aviso em tempo real para as telas abertas (SSE). Nunca derruba o fluxo principal.
 * O escopo (`scope`) sai do mapa `SCOPE_OF` pelo `type`: as telas só recarregam o que mostram.
 */
export async function emit(type: string, data: { dealId?: string; userId?: string | null; [k: string]: unknown } = {}) {
  try { await notify({ type, ...data, scope: scopesOf({ type, ...data }) }); } catch (e) { console.error("[emit] falhou", e); }
}
