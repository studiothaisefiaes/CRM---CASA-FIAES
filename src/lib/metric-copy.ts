import { money } from "./format";
import { MIN_SAMPLE } from "./report-format";

/**
 * O que cada número dos Relatórios quer dizer, em português de quem usa (a regra exata fica no "Como é calculado").
 * `better`: qual direção é boa, só quando é óbvio; null = não julga. Nunca há meta inventada.
 */
export type MetricKey = "leadsNovos" | "pctPrimeiraRespostaNoSla" | "agendamentosMarcados" | "vendas" | "ticketMedio";
export const METRIC_COPY: Record<MetricKey, { what: string; better: "up" | "down" | null; unit: "count" | "pct" | "cents" }> = {
  leadsNovos: { what: "Pessoas que procuraram a Casa pela primeira vez no período.", better: "up", unit: "count" },
  pctPrimeiraRespostaNoSla: { what: "Quantas foram respondidas dentro do prazo da etapa na primeira mensagem.", better: "up", unit: "pct" },
  agendamentosMarcados: { what: "Das conversas novas, quantas chegaram a marcar horário.", better: "up", unit: "count" },
  vendas: { what: "Conversas que viraram venda no período, pela data em que fecharam. Não é o Faturado do Salão, que soma as comandas pagas.", better: "up", unit: "count" },
  ticketMedio: { what: "Quanto, em média, cada venda com valor informado rendeu (o ticket médio).", better: null, unit: "cents" },
};

/** "a" + rótulo com a contração certa: "ao mesmo tempo…", "aos 7 dias…", "a ontem…". */
const toLabel = (label: string) => (label.startsWith("os ") ? `aos ${label.slice(3)}` : label.startsWith("o ") ? `ao ${label.slice(2)}` : label.startsWith("as ") ? `às ${label.slice(3)}` : label.startsWith("a ") ? `à ${label.slice(2)}` : `a ${label}`);

const fmt = (key: MetricKey, v: number) => {
  const u = METRIC_COPY[key].unit;
  return u === "pct" ? `${v}%` : u === "cents" ? money(v).replace(/ /g, " ") : String(v);
};

/**
 * A leitura da comparação numa frase: "Subiu de 12 para 18 em relação a ontem até a mesma hora. Bom sinal."
 * Só diz se é bom ou ruim quando os dois períodos têm base (MIN_SAMPLE) e o sentido do número é óbvio.
 */
export function readDelta(key: MetricKey, cur: number | null, prev: number | null, n: number, nPrev: number, prevLabel: string): string {
  if (cur == null) return "Sem dados no período.";
  if (prev == null) return "Primeiro período com dados para comparar.";
  if (cur === prev) return `Igual ${toLabel(prevLabel)} (${fmt(key, cur)}).`;
  const up = cur > prev;
  const base = `${up ? "Subiu" : "Caiu"} de ${fmt(key, prev)} para ${fmt(key, cur)} em relação ${toLabel(prevLabel)}.`;
  if (n < MIN_SAMPLE) return `${base} Ainda são poucos casos (${n}) para tirar conclusão.`;
  if (nPrev < MIN_SAMPLE) return `${base} O período anterior teve poucos casos (${nPrev}) para comparar.`;
  const better = METRIC_COPY[key].better;
  if (!better) return base;
  const good = better === "up" ? up : !up;
  return `${base} ${good ? "Bom sinal." : "Vale olhar."}`;
}
