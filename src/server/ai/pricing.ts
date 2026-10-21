/**
 * Preços do Claude Haiku 5.5 (US$ por milhão de tokens, prompt até 100 mil tokens: o nosso fica bem abaixo).
 * Constantes de propósito: o teto de gasto soma o custo calculado aqui, sem depender de consultar a Anthropic.
 */
export const HAIKU_PRICES = { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 } as const;
/**
 * Sonnet (20/10: a sugestão passou do Haiku para o Sonnet, o dono achou o Haiku fraco). Estimativa CONSERVADORA (para cima): o teto de gasto
 * para antes, nunca depois. Ajuste quando a fatura mostrar o valor real.
 */
export const SONNET_PRICES = { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 } as const;
export const pricesFor = (model: string) => (/sonnet|opus/i.test(model) ? SONNET_PRICES : HAIKU_PRICES);

export type Usage = { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number };

/** Custo em milionésimos de dólar (US$ 1 = 1.000.000). US$/M tokens × tokens = micros. Arredonda para cima. */
export function costMicros(u: Usage, p: { input: number; cacheRead: number; cacheWrite: number; output: number } = HAIKU_PRICES): number {
  const raw = u.inputTokens * p.input + u.cachedTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite + u.outputTokens * p.output;
  return Math.ceil(Math.round(raw * 1000) / 1000);
}

/** "US$ 1,23"; abaixo de 1 centavo mostra mais casas ("US$ 0,004", "US$ 0,00018") para não parecer zero. */
export function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  const digits = usd > 0 && usd < 0.001 ? 5 : usd > 0 && usd < 0.01 ? 3 : 2;
  return `US$ ${usd.toFixed(digits).replace(".", ",")}`;
}
