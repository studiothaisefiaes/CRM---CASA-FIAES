import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { aiLicoes, aiSuggestions, settings } from "../db/schema";
import { ANTHROPIC_URL, thinkingFor } from "./client";
import { costMicros, pricesFor } from "./pricing";
import { aiEnv, aiSpend, budgetState, getAiSettings } from "./settings";
import { redact } from "./redact";

/**
 * Lições das edições (dono, 02/11: "a IA ainda não está no ponto"): a equipe edita mais da metade das sugestões e quase ninguém usa o
 * Rebater. Uma vez por dia, depois do expediente, a IA compara o que sugeriu com o que a equipe mandou de verdade (sugestões editadas ou
 * trocadas) e propõe até 3 regras gerais. Entram como PENDENTES em Configurações › IA: só valem quando a gestão toca "Usar sempre".
 * Nada vai para cliente; nada de dado de cliente na regra (nome, telefone e CPF saem antes).
 */
export const LICOES_EDICOES_KEY = "ia_licoes_edicoes_dia";
const MIN_PARES = 4;
const MAX_PARES = 25;
const MAX_NOVAS = 3;

type Par = { cliente: string; ia: string; equipe: string };

/** Os pares do dia: sugestão usada e muito mexida, ou não usada com a equipe respondendo outra coisa em até 30 min. */
export async function paresDoDia(desde: Date, ate: Date): Promise<Par[]> {
  const r = await db.execute<{ cliente: string | null; ia: string; equipe: string | null }>(sql`
    with s as (
      select s.id, s.sugestao, s.used_at, s.created_at, s.deal_id,
        (select m.body from messages m where m.id = s.last_message_id) cliente,
        (select regexp_replace(m.body, '^\\*[^*]+\\*\\s*', '') from messages m where m.deal_id = s.deal_id and m.direction = 'out' and m.kind = 'text'
           and (m.sent_by_user_id is not null or m.from_phone) and m.created_at between coalesce(s.used_at, s.created_at) and coalesce(s.used_at, s.created_at) + interval '30 minutes'
         order by m.created_at limit 1) equipe
      from ai_suggestions s
      where s.origin in ('auto', 'outra') and s.sugestao <> '' and s.created_at >= ${desde.toISOString()}::timestamptz and s.created_at < ${ate.toISOString()}::timestamptz)
    select cliente, sugestao ia, equipe from s where equipe is not null and length(equipe) > 1 and similarity(equipe, sugestao) < 0.6
    order by created_at desc limit ${MAX_PARES}`);
  return r.rows.filter((x) => x.equipe).map((x) => ({ cliente: redact(x.cliente ?? "").slice(0, 300), ia: redact(x.ia).slice(0, 500), equipe: redact(x.equipe!).slice(0, 500) }));
}

const SCHEMA = { type: "object", properties: { licoes: { type: "array", items: { type: "string" }, description: "Até 3 regras gerais, curtas, no imperativo." } }, required: ["licoes"], additionalProperties: false } as const;

export function promptLicoes(pares: Par[], existentes: string[]): { system: string; user: string } {
  const system = "Você ajuda a melhorar a IA que sugere respostas de WhatsApp para a recepção de um salão (Casa Fiaes). Compare o que a IA sugeriu com o que a equipe realmente enviou e escreva no máximo 3 regras GERAIS que explicam as diferenças que se repetem (tamanho, tom, o que a equipe corta, o que acrescenta, fatos e valores que a equipe usa). Cada regra: uma frase no imperativo, até 200 caracteres, sem nome, telefone ou dado de cliente. Não repita regra que já existe. Se não houver padrão claro, devolva lista vazia.";
  const user = [`Regras que já existem:\n${existentes.map((l) => `- ${l}`).join("\n") || "(nenhuma)"}`,
    ...pares.map((p, i) => `#${i + 1}\nCliente: ${p.cliente}\nIA sugeriu: ${p.ia}\nEquipe enviou: ${p.equipe}`)].join("\n\n");
  return { system, user };
}

export type LicoesCaller = (body: Record<string, unknown>) => Promise<{ text: string; usage: { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number }; model: string }>;
const realCaller: LicoesCaller = async (body) => {
  const { apiKey, baseUrl } = aiEnv();
  const res = await fetch(baseUrl ?? ANTHROPIC_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`IA respondeu ${res.status}`);
  const j = (await res.json()) as { model?: string; content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const u = j.usage ?? {};
  return { text: j.content?.find((c) => c.type === "text")?.text ?? "", model: j.model ?? String(body.model),
    usage: { inputTokens: u.input_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } };
};

/** Uma vez por dia, a partir das 19h de Salvador. Devolve quantas lições pendentes nasceram. Nunca lança. */
export async function licoesDasEdicoes(now = new Date(), caller: LicoesCaller = realCaller): Promise<number> {
  try {
    const local = new Date(now.getTime() - 3 * 3_600_000);
    if (local.getUTCHours() < 19) return 0;
    const dia = local.toISOString().slice(0, 10);
    const [ja] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, LICOES_EDICOES_KEY));
    if (ja?.value === dia) return 0;
    await db.insert(settings).values({ key: LICOES_EDICOES_KEY, value: dia }).onConflictDoUpdate({ target: settings.key, set: { value: dia, updatedAt: now } });
    const s = await getAiSettings();
    const { apiKey, model } = aiEnv();
    if (!s.enabled || !apiKey || budgetState(s, await aiSpend(now)) !== "ok") return 0;
    const pares = await paresDoDia(new Date(now.getTime() - 86_400_000), now);
    if (pares.length < MIN_PARES) return 0;
    const existentes = (await db.select({ l: aiLicoes.licao }).from(aiLicoes).where(sql`${aiLicoes.status} in ('pendente', 'aprovada')`)).map((r) => r.l);
    const { system, user } = promptLicoes(pares, existentes);
    const r = await caller({ model, max_tokens: 600, system, messages: [{ role: "user", content: user }], ...thinkingFor(model), output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } } });
    await db.insert(aiSuggestions).values({ dealId: null, lastMessageId: null, resumo: "", sugestao: "", origin: "comando", motivo: "licoes_edicoes", model: r.model, createdAt: now, dismissedAt: now,
      inputTokens: r.usage.inputTokens, cachedTokens: r.usage.cachedTokens, cacheWriteTokens: r.usage.cacheWriteTokens, outputTokens: r.usage.outputTokens, costUsdMicros: costMicros(r.usage, pricesFor(r.model)) });
    const licoes = ((JSON.parse(r.text) as { licoes?: unknown }).licoes ?? []) as unknown[];
    const novas = licoes.filter((l): l is string => typeof l === "string").map((l) => l.replace(/\s+/g, " ").trim().slice(0, 300)).filter((l) => l.length >= 12).slice(0, MAX_NOVAS);
    const critica = `Edições da equipe em ${dia.split("-").reverse().slice(0, 2).join("/")}: ${pares.length} respostas que a equipe mudou`;
    for (const licao of novas) await db.insert(aiLicoes).values({ suggestionId: null, critica, licao, createdBy: null });
    return novas.length;
  } catch (e) { console.error("[lições das edições]", e instanceof Error ? e.message : e); return 0; }
}
