/**
 * Único lugar que sabe para onde os números dos relatórios apontam. A Fila (/atendimento) nasce na T15, que troca os destinos aqui.
 * Enquanto isso o Funil entende só os filtros de SUPPORTED_FILTERS.
 */
export const SUPPORTED_FILTERS = ["atrasados", "esperando", "parados"] as const;
export type FunilFilter = (typeof SUPPORTED_FILTERS)[number];

export const parseFunilFilter = (v: unknown): FunilFilter | null => ((SUPPORTED_FILTERS as readonly unknown[]).includes(v) ? (v as FunilFilter) : null);

export const lateHref = () => "/funil?filtro=atrasados";
export const waitingHref = () => "/funil?filtro=esperando";
export const staleHref = (stageKey?: string) => `/funil?filtro=parados${stageKey ? `&etapa=${encodeURIComponent(stageKey)}` : ""}`;

/** Converte um link devolvido por `dailySummaryText` no destino que existe hoje; null quando a lista filtrada ainda não existe. */
export function summaryLinkHref(href: string): string | null {
  const url = new URL(href, "http://x");
  const filtro = url.searchParams.get("filtro");
  if (url.pathname === "/relatorios") return href;
  if (!filtro) return href;
  if (!parseFunilFilter(filtro)) return null;
  return `/funil?filtro=${filtro}`;
}
