/**
 * Único lugar que sabe para onde os números dos relatórios apontam. A Fila (/atendimento) nasce na T15, que troca os destinos aqui.
 * Enquanto isso o Funil entende só os filtros de SUPPORTED_FILTERS.
 */
export const SUPPORTED_FILTERS = ["atrasados", "esperando", "parados"] as const;
export type FunilFilter = (typeof SUPPORTED_FILTERS)[number];

export const parseFunilFilter = (v: unknown): FunilFilter | null => ((SUPPORTED_FILTERS as readonly unknown[]).includes(v) ? (v as FunilFilter) : null);

/** Escopo da tela que o drill-down leva junto: pessoa (`dono`) e origem real (`fonte`). */
export type LinkScope = { dono?: string | null; fonte?: string | null };
const href = (params: Record<string, string | undefined>, scope?: LinkScope) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, dono: scope?.dono ?? undefined, fonte: scope?.fonte ?? undefined })) if (v) q.set(k, v);
  return `/funil?${q}`;
};

export const lateHref = (scope?: LinkScope) => href({ filtro: "atrasados" }, scope);
export const waitingHref = (scope?: LinkScope) => href({ filtro: "esperando" }, scope);
export const staleHref = (stageKey?: string, scope?: LinkScope) => href({ filtro: "parados", etapa: stageKey }, scope);

/** Converte um link devolvido por `dailySummaryText` no destino que existe hoje; null quando a lista filtrada ainda não existe. */
export function summaryLinkHref(href: string): string | null {
  const url = new URL(href, "http://x");
  const filtro = url.searchParams.get("filtro");
  if (url.pathname === "/relatorios") return href;
  if (!filtro) return href;
  if (!parseFunilFilter(filtro)) return null;
  return `/funil?filtro=${filtro}`;
}
