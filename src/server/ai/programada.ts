import { db } from "../db";
import { aiSuggestions } from "../db/schema";
import { AiError, callLegivel, callSuggestion } from "./client";
import { costMicros } from "./pricing";
import { buildProgramadaUser, buildSystem, MAX_TEMA_CHARS } from "./prompt";
import { aiEnv, aiSpend, budgetState, getAiSettings } from "./settings";
import { consentAiBlocked, loadCasaData, loadConversation, type Caller, type SkipReason } from "./suggest";

/**
 * "Escrever com IA" no Retomar/Programar mensagem (pedido do dono, 16/10): a atendente diz o TEMA, a IA lê a conversa e devolve o texto.
 * NUNCA programa nem envia nada: o texto só volta para o campo da mensagem do diálogo (editável) e quem confirma é a atendente.
 * Uma conversa: o mesmo contexto enxuto da sugestão. Lote: UM modelo com {primeiro_nome}, sem ler conversa nenhuma (economia).
 * O uso fica em `ai_suggestions` (origin "programada", sem conversa ligada) e entra no teto e no gasto do mês.
 */
export type ProgramadaResult =
  | { status: "gerada"; texto: string; costMicros: number }
  | { status: "pulada"; motivo: SkipReason | "sem_tema" }
  | { status: "falhou"; erro: string };

/** Ligada e com chave no servidor: só então o botão aparece. */
export async function programadaAvailable(): Promise<boolean> {
  return (await getAiSettings()).enabled && !!aiEnv().apiKey;
}

export async function generateProgramada(input: {
  /** 1 conversa: lê a conversa. 2 ou mais (lote): modelo com {primeiro_nome}, sem ler. */
  dealIds: string[]; tema: string; sendAt: Date; anterior?: string | null; userId?: string | null; now?: Date; caller?: Caller;
}): Promise<ProgramadaResult> {
  const now = input.now ?? new Date();
  const tema = input.tema.replace(/\s+/g, " ").trim().slice(0, MAX_TEMA_CHARS);
  if (tema.length < 3) return { status: "pulada", motivo: "sem_tema" };
  const s = await getAiSettings();
  if (!s.enabled) return { status: "pulada", motivo: "desligada" };
  const { apiKey, model, baseUrl } = aiEnv();
  if (!apiKey) return { status: "pulada", motivo: "sem_chave" };
  const budget = budgetState(s, await aiSpend(now));
  if (budget !== "ok") return { status: "pulada", motivo: budget };

  const single = input.dealIds.length === 1;
  if (single && await consentAiBlocked(input.dealIds[0])) return { status: "pulada", motivo: "sem_consentimento_ia" };
  const [conv, casa] = await Promise.all([single ? loadConversation(input.dealIds[0], now) : null, loadCasaData()]);
  if (single && !conv) return { status: "pulada", motivo: "conversa_fechada" };
  const user = buildProgramadaUser({ tema, sendAt: input.sendAt, now, conversation: conv?.data ?? null, anterior: input.anterior });
  const base = { dealId: null, lastMessageId: null, resumo: "", model, origin: "programada" as const, requestedBy: input.userId ?? null, createdAt: now };
  try {
    // Texto embaralhado: pede de novo 1 vez; o texto que fica já vem pós-processado (src/server/ai/pos.ts).
    const r = await callLegivel(() => (input.caller ?? callSuggestion)({ system: buildSystem(casa), user }, { apiKey, model, baseUrl }), casa.nomes);
    const texto = r.data.sugestao.trim();
    await db.insert(aiSuggestions).values({ ...base, sugestao: texto, model: r.model, inputTokens: r.usage.inputTokens, cachedTokens: r.usage.cachedTokens,
      cacheWriteTokens: r.usage.cacheWriteTokens, outputTokens: r.usage.outputTokens, costUsdMicros: r.costMicros, dismissedAt: texto ? null : now });
    if (!texto) return { status: "falhou", erro: "vazia" };
    return { status: "gerada", texto, costMicros: r.costMicros };
  } catch (e) {
    const err = e instanceof AiError ? e : null;
    // A Anthropic cobrou (fora do formato, recusa): o custo entra no teto mesmo sem texto.
    if (err?.usage) {
      await db.insert(aiSuggestions).values({ ...base, sugestao: "", motivo: `falhou: ${err.code}`, inputTokens: err.usage.inputTokens, cachedTokens: err.usage.cachedTokens,
        cacheWriteTokens: err.usage.cacheWriteTokens, outputTokens: err.usage.outputTokens, costUsdMicros: costMicros(err.usage), dismissedAt: now });
    }
    console.error("[mensagem programada por IA] falhou", err ? `${err.code}: ${err.message}` : e);
    return { status: "falhou", erro: err ? `${err.code}: ${err.message}` : String(e) };
  }
}
