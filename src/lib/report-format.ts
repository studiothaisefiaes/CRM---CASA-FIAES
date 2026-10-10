import { money } from "./format";

/** Tamanho mínimo de amostra para mostrar % ou pintar uma comparação de "bom" ou "ruim". */
export const MIN_SAMPLE = 20;

export type CompareKind = "count" | "pct" | "cents" | "seconds";
export type Comparison = {
  direction: "up" | "down" | "flat" | "none";
  /** "good" e "bad" só existem com amostra suficiente dos dois lados; senão a seta fica neutra. */
  tone: "good" | "bad" | "neutral";
  variation: string | null;
  text: string;
};

const MINUS = "−";

/**
 * Compara o período atual com o anterior: seta, variação (relativa; em pontos percentuais para %) e um tom.
 * O tom de bom/ruim só aparece com n >= 20 nos dois períodos: com pouca amostra a variação é ruído.
 */
export function compareMetric(cur: number | null, prev: number | null, o: { kind: CompareKind; n: number; nPrev: number; lowerIsBetter?: boolean }): Comparison {
  if (cur == null || prev == null) return { direction: "none", tone: "neutral", variation: null, text: "sem comparação" };
  if (cur === prev) return { direction: "flat", tone: "neutral", variation: null, text: "→ igual" };
  const up = cur > prev;
  const arrow = up ? "↑" : "↓";
  const sign = up ? "+" : MINUS;
  let variation: string | null;
  if (o.kind === "pct") variation = `${sign}${Math.abs(Math.round(cur - prev))} p.p.`;
  else if (prev === 0) variation = null; // crescer a partir de zero não tem %
  else variation = `${sign}${Math.abs(Math.round(((cur - prev) / prev) * 100))}%`;
  const enough = o.n >= MIN_SAMPLE && o.nPrev >= MIN_SAMPLE;
  const good = o.lowerIsBetter ? !up : up;
  return {
    direction: up ? "up" : "down", tone: enough ? (good ? "good" : "bad") : "neutral", variation,
    text: variation ? `${arrow} ${variation}` : `${arrow} antes: ${prev}`,
  };
}

export const insufficientText = (n: number) => `Sem dados suficientes (n = ${n})`;

/** "3 de 9" com amostra pequena, "33%" a partir de 20; null sem base. */
export function shareText(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return whole < MIN_SAMPLE ? `${part} de ${whole}` : `${Math.round((100 * part) / whole)}%`;
}

/** Ticket médio com o n que o sustenta; sem venda com valor é traço, nunca "R$ 0,00". */
export const ticketText = (cents: number | null, n: number) => `${cents == null ? "—" : money(cents).replace(/\u00a0/g, " ")} (n = ${n})`;

/** Com o que o período atual é comparado (a legenda da comparação). */
export const PREVIOUS_LABEL = { hoje: "ontem até a mesma hora", "7d": "os 7 dias anteriores", mes: "o mesmo tempo do mês anterior", ano: "o mesmo tempo do ano anterior" } as const;

/** Duração corrida curta: "40 min", "5 h", "3 d". */
export function longSpan(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} h`;
  return `${Math.floor(sec / 86_400)} d`;
}
