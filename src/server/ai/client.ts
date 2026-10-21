import { z } from "zod";
import { stripSignature } from "@/lib/signature";
import { costMicros, type Usage, pricesFor } from "./pricing";
import { pareceIlegivel, posProcessar } from "./pos";

/**
 * Cliente fino da Messages API da Anthropic (fetch, sem SDK): um pedido, tempo limite, uma nova tentativa em erro passageiro
 * e a resposta em JSON conferida com zod. Só devolve texto: quem decide o que fazer com ele é a atendente.
 */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
/** 20/10: Sonnet (o Haiku errava o pedido da atendente e soava seco). O servidor pode trocar por AI_MODEL no .env. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** O formato da resposta (structured output). Sem campo extra; os 6 obrigatórios (`horario` vazio = sem horário proposto; `retomar_dias` 0 = sem retomada). */
export const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    resumo: { type: "string", description: "Uma frase curta do que a cliente quer agora." },
    sugestao: { type: "string", description: "A mensagem pronta para a atendente enviar no WhatsApp, sem assinatura." },
    precisa_humano: { type: "boolean", description: "true se a conversa pede decisão de alguém da equipe (reclamação, desconto, remarcação, caso delicado)." },
    motivo: { type: "string", description: "Curto: por que precisa de alguém da equipe. Vazio quando precisa_humano é false." },
    horario: { type: "string", description: "O id (h1, h2… ou hc) do horário principal que a mensagem propõe ou confirma. Vazio se não propôs horário." },
    retomar_dias: { type: "integer", description: "Só quando a cliente cancelou ou desmarcou e NÃO marcou outra data: em quantos dias a Casa deve retomar o contato (15 a 30). 0 em todos os outros casos." },
  },
  required: ["resumo", "sugestao", "precisa_humano", "motivo", "horario", "retomar_dias"],
  additionalProperties: false,
} as const;

export const suggestionSchema = z.object({
  resumo: z.string().trim().max(400),
  sugestao: z.string().max(2000).transform((s) => stripSignature(s.trim()).trim()),
  precisa_humano: z.boolean(),
  motivo: z.string().trim().max(400),
  /** Id do horário proposto ("h3", "hc"); vazio/ausente = nenhum. Quem confere se existe é o servidor (suggest.ts). */
  horario: z.string().trim().max(12).nullish(),
  /** Cancelou sem nova data (Cati 17/10): em quantos dias retomar; 0/ausente = nada. Quem decide se vira proposta é o servidor (suggest.ts). */
  retomar_dias: z.number().int().min(0).max(365).nullish().catch(null),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export type AiErrorCode = "sem_chave" | "timeout" | "rede" | "http" | "recusa" | "formato" | "ilegivel";
export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string, public status?: number, public usage?: Usage) { super(message); this.name = "AiError"; }
}

export type CallOptions = {
  apiKey: string | undefined | null;
  model: string;
  fetchImpl?: typeof fetch;
  /** Tempo limite de cada tentativa (padrão 20 s). */
  timeoutMs?: number;
  /** Espera antes da segunda tentativa (padrão 1,5 s). */
  retryDelayMs?: number;
  maxTokens?: number;
  baseUrl?: string;
};

export type CallResult = { data: Suggestion; usage: Usage; costMicros: number; model: string };

type ApiUsage = { input_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; output_tokens?: number };
type ApiResponse = { model?: string; stop_reason?: string; content?: { type: string; text?: string }[]; usage?: ApiUsage };

const toUsage = (u: ApiUsage | undefined): Usage => ({
  inputTokens: u?.input_tokens ?? 0, cachedTokens: u?.cache_read_input_tokens ?? 0, cacheWriteTokens: u?.cache_creation_input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0,
});
/**
 * Sem raciocínio, do jeito que cada modelo aceita (20/10: o Sonnet 5.5 recusa `disabled` com 400 e TODA sugestão falhava):
 * Sonnet 5.5 → `between_tools` (não pensa antes de responder; vale com esforço até `high`); Opus 5.5 não desliga (fica o adaptativo,
 * contido pelo esforço baixo); os outros (Haiku 5.5) → `disabled`.
 */
export function thinkingFor(model: string): { thinking?: { type: "disabled" | "between_tools" } } {
  if (/sonnet-5-5/i.test(model)) return { thinking: { type: "between_tools" } };
  if (/opus-5-5/i.test(model)) return {};
  return { thinking: { type: "disabled" } };
}
const transient = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

async function once(input: { system: string; user: string }, o: CallOptions): Promise<CallResult> {
  const f = o.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await f(o.baseUrl ?? ANTHROPIC_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": o.apiKey!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: o.model,
        // Resposta curta (o JSON com 1 a 3 frases cabe folgado): teto baixo para nunca gastar à toa.
        max_tokens: o.maxTokens ?? 600, // 250 cortava respostas longas no meio (JSON inválido, "A IA não respondeu"); só paga o que usar
        // O bloco fixo (jeito da Casa, serviços e preços, horário, endereço, regras) é igual em toda chamada: fica no cache.
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: input.user }],
        // Sem raciocínio estendido e esforço baixo: resposta curta de WhatsApp, pensar só gasta token.
        ...thinkingFor(o.model),
        output_config: { effort: "low", format: { type: "json_schema", schema: SUGGESTION_JSON_SCHEMA } },
      }),
    });
  } catch (e) {
    if (ctrl.signal.aborted || (e as Error)?.name === "AbortError") throw new AiError("timeout", "A IA demorou demais para responder.");
    throw new AiError("rede", `Sem conexão com a IA: ${(e as Error)?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiError("http", `A IA respondeu ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }
  const body = (await res.json().catch(() => null)) as ApiResponse | null;
  const usage = toUsage(body?.usage);
  if (body?.stop_reason === "refusal") throw new AiError("recusa", "A IA recusou esta conversa.", 200, usage);
  const text = body?.content?.find((c) => c.type === "text")?.text;
  let parsed: unknown;
  try { parsed = JSON.parse(text ?? ""); } catch { throw new AiError("formato", `Resposta fora do formato (${body?.stop_reason ?? "sem motivo"}).`, 200, usage); }
  const ok = suggestionSchema.safeParse(parsed);
  if (!ok.success) throw new AiError("formato", "Resposta fora do formato.", 200, usage);
  return { data: ok.data, usage, costMicros: costMicros(usage, pricesFor(o.model)), model: body?.model ?? o.model };
}

/** Uma chamada; repete UMA vez em tempo esgotado, rede ou erro passageiro (429/5xx). Pedido errado (4xx), recusa e formato não repetem. */
export async function callSuggestion(input: { system: string; user: string }, o: CallOptions): Promise<CallResult> {
  if (!o.apiKey) throw new AiError("sem_chave", "A chave da IA não está configurada no servidor.");
  try {
    return await once(input, o);
  } catch (e) {
    const retry = e instanceof AiError && (e.code === "timeout" || e.code === "rede" || (e.code === "http" && transient(e.status ?? 0)));
    if (!retry) throw e;
    await new Promise((r) => setTimeout(r, o.retryDelayMs ?? 1_500));
    return once(input, o);
  }
}

const ZERO: Usage = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
const plus = (a: Usage, b: Usage | undefined): Usage => ({
  inputTokens: a.inputTokens + (b?.inputTokens ?? 0), cachedTokens: a.cachedTokens + (b?.cachedTokens ?? 0),
  cacheWriteTokens: a.cacheWriteTokens + (b?.cacheWriteTokens ?? 0), outputTokens: a.outputTokens + (b?.outputTokens ?? 0),
});

/** A mensagem que a tela mostra quando a IA devolveu texto embaralhado duas vezes. */
export const ILEGIVEL_MSG = "A IA devolveu um texto embaralhado. Peça de novo em instantes.";

/**
 * Chama a IA e entrega o texto já pós-processado (src/server/ai/pos.ts: Thaise sem artigo, Método Fiaes®, sem promessa de retorno,
 * uma pergunta só). Texto embaralhado ou fora do formato: pede de novo UMA vez; ruim de novo → AiError "ilegivel" (com o custo das
 * duas chamadas, que entra no teto). O custo devolvido soma as chamadas.
 */
export async function callLegivel(call: () => Promise<CallResult>, nomes: string[] = []): Promise<CallResult> {
  let spent: Usage | null = null;
  for (let k = 0; k < 2; k++) {
    try {
      const r: CallResult = await call();
      const usage: Usage = spent ? plus(spent, r.usage) : r.usage;
      if (!pareceIlegivel(r.data.sugestao)) {
        return { ...r, usage, costMicros: spent ? costMicros(usage, pricesFor(r.model)) : r.costMicros, data: { ...r.data, sugestao: posProcessar(r.data.sugestao, nomes) } };
      }
      spent = usage;
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== "formato") {
        if (spent && e instanceof AiError) e.usage = plus(spent, e.usage);
        throw e;
      }
      spent = plus(spent ?? ZERO, e.usage);
    }
  }
  throw new AiError("ilegivel", ILEGIVEL_MSG, 200, spent ?? undefined);
}
