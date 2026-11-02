import { z } from "zod";
import { db } from "../db";
import { aiSuggestions } from "../db/schema";
import { ANTHROPIC_URL, AiError, thinkingFor } from "../ai/client";
import { costMicros, pricesFor, type Usage } from "../ai/pricing";
import { aiEnv, aiSpend, budgetState, getAiSettings } from "../ai/settings";
import { UserFacingError } from "../domain/errors";

/**
 * Comando de voz (dono, 02/11): a frase falada ou digitada vira UMA ação estruturada. A IA só interpreta: nunca executa nada.
 * Quem confere cliente, profissional, serviço e horário é o servidor (resolver.ts), e quem executa é o Confirmar da tela.
 */
export const ACOES = ["marcar", "remarcar", "cancelar", "retomar", "nota", "resolver", "abrir", "nao_entendi"] as const;
export type Acao = (typeof ACOES)[number];

const str = (d: string) => ({ type: ["string", "null"], description: d });
export const COMANDO_SCHEMA = {
  type: "object",
  properties: {
    acao: { type: "string", enum: [...ACOES], description: "marcar = novo horário; remarcar = mudar o horário que já existe; cancelar = desmarcar; retomar = programar a retomada (voltar a falar com a cliente numa data); nota = anotar algo na cliente; resolver = marcar a conversa como Resolvida; abrir = abrir a conversa da cliente; nao_entendi = não dá para saber." },
    cliente: str("Nome da cliente como foi dito, sem títulos (\"a Maria Silva\" → \"Maria Silva\")."),
    telefone: str("Telefone dito, só dígitos."),
    servico_id: str("id do serviço da lista, o mais parecido com o que foi dito."),
    profissional_id: str("id da profissional da lista."),
    data: str("Dia no formato AAAA-MM-DD, calculado a partir de hoje (\"amanhã\", \"sexta\", \"dia 4\")."),
    hora: str("Hora de início HH:MM (24 h)."),
    hora_fim: str("Hora de término HH:MM, se foi dita (\"das 9 às 13\")."),
    texto: str("Para nota: o texto da nota. Para retomar: o que a equipe deve falar com ela. Para cancelar: o motivo dito."),
    duvida: str("Se faltou algo essencial ou ficou ambíguo, a pergunta curta para a pessoa."),
  },
  required: ["acao", "cliente", "telefone", "servico_id", "profissional_id", "data", "hora", "hora_fim", "texto", "duvida"],
  additionalProperties: false,
} as const;

const hhmm = z.string().regex(/^\d{2}:\d{2}$/).nullable();
export const interpretacaoSchema = z.object({
  acao: z.enum(ACOES), cliente: z.string().nullable(), telefone: z.string().nullable(), servico_id: z.string().nullable(), profissional_id: z.string().nullable(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), hora: hhmm, hora_fim: hhmm, texto: z.string().nullable(), duvida: z.string().nullable(),
});
export type Interpretacao = z.infer<typeof interpretacaoSchema>;

export type Catalogo = { profissionais: { id: string; name: string }[]; servicos: { id: string; label: string }[] };
export type Caller = (body: Record<string, unknown>) => Promise<{ text: string; usage: Usage; model: string }>;

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function hojeEmSalvador(now: Date): string {
  const l = new Date(now.getTime() - 3 * 3_600_000);
  return `${l.toISOString().slice(0, 10)} (${DIAS[l.getUTCDay()]}), ${l.toISOString().slice(11, 16)}`;
}

export function buildPrompt(frase: string, cat: Catalogo, now: Date): { system: string; user: string } {
  const system = [
    "Você interpreta comandos da recepção de um salão de beleza em Salvador (Casa Fiaes) para o sistema de agenda e atendimento.",
    "Devolva só o JSON pedido. Nunca invente cliente, serviço ou profissional: use null quando não foi dito. Use os ids exatos das listas.",
    "\"Thaise\" é a dona e também profissional. Horário sem manhã/tarde: entre 7 e 11 é manhã; 1 a 6 é tarde (13 a 18).",
    `PROFISSIONAIS (id | nome):\n${cat.profissionais.map((p) => `${p.id} | ${p.name}`).join("\n")}`,
    `SERVIÇOS (id | nome):\n${cat.servicos.map((s) => `${s.id} | ${s.label}`).join("\n")}`,
  ].join("\n\n");
  return { system, user: `Agora em Salvador: ${hojeEmSalvador(now)}.\nComando: ${frase}` };
}

const realCaller: Caller = async (body) => {
  const { apiKey, baseUrl } = aiEnv();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(baseUrl ?? ANTHROPIC_URL, { method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if (!res.ok) throw new AiError("http", `A IA respondeu ${res.status}`, res.status);
    const j = (await res.json()) as { model?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } };
    const u = j.usage ?? {};
    return { text: j.content?.find((c) => c.type === "text")?.text ?? "", model: j.model ?? String(body.model),
      usage: { inputTokens: u.input_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } };
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(ctrl.signal.aborted ? "timeout" : "rede", "Sem resposta da IA.");
  } finally { clearTimeout(timer); }
};

export async function interpretar(frase: string, cat: Catalogo, userId: string, now = new Date(), caller: Caller = realCaller): Promise<Interpretacao> {
  const texto = frase.replace(/\s+/g, " ").trim().slice(0, 600);
  if (texto.length < 4) throw new UserFacingError("Fale ou digite o que quer fazer.");
  const s = await getAiSettings();
  const { apiKey, model } = aiEnv();
  if (!s.enabled || !apiKey) throw new UserFacingError("A IA está desligada em Configurações › Conversas.");
  if (budgetState(s, await aiSpend(now)) !== "ok") throw new UserFacingError("A IA chegou ao limite de gasto. Faça pela tela.");
  const { system, user } = buildPrompt(texto, cat, now);
  let r: Awaited<ReturnType<Caller>>;
  try {
    r = await caller({ model, max_tokens: 500, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }], ...thinkingFor(model), output_config: { effort: "low", format: { type: "json_schema", schema: COMANDO_SCHEMA } } });
  } catch (e) {
    console.error("[comando] IA falhou", e instanceof Error ? e.message : e);
    throw new UserFacingError("A IA não respondeu agora. Tente de novo.");
  }
  await db.insert(aiSuggestions).values({ dealId: null, lastMessageId: null, resumo: "", sugestao: "", origin: "comando", model: r.model, requestedBy: userId, createdAt: now,
    inputTokens: r.usage.inputTokens, cachedTokens: r.usage.cachedTokens, cacheWriteTokens: r.usage.cacheWriteTokens, outputTokens: r.usage.outputTokens,
    costUsdMicros: costMicros(r.usage, pricesFor(r.model)), dismissedAt: now });
  let parsed: unknown;
  try { parsed = JSON.parse(r.text); } catch { throw new UserFacingError("Não entendi. Fale de novo, com calma."); }
  const ok = interpretacaoSchema.safeParse(parsed);
  if (!ok.success) throw new UserFacingError("Não entendi. Fale de novo, com calma.");
  return ok.data;
}
