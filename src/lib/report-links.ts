/**
 * Único lugar que sabe para onde os números dos relatórios apontam: a Fila (/atendimento?filtro=…).
 * O Quadro (/funil) ainda entende só os três primeiros filtros (SUPPORTED_FILTERS); a Fila entende todos (QUEUE_FILTERS).
 */
export const SUPPORTED_FILTERS = ["atrasados", "esperando", "parados"] as const;
export type FunilFilter = (typeof SUPPORTED_FILTERS)[number];
export const parseFunilFilter = (v: unknown): FunilFilter | null => ((SUPPORTED_FILTERS as readonly unknown[]).includes(v) ? (v as FunilFilter) : null);

export const QUEUE_FILTERS = [...SUPPORTED_FILTERS, "tarefas-atrasadas", "agendados-amanha", "novos"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export const parseQueueFilter = (v: unknown): QueueFilter | null => ((QUEUE_FILTERS as readonly unknown[]).includes(v) ? (v as QueueFilter) : null);
export const FILTER_LABEL: Record<QueueFilter, string> = {
  atrasados: "Leads atrasados", esperando: "Leads esperando resposta", parados: "Leads parados", "tarefas-atrasadas": "Leads com tarefa atrasada",
  "agendados-amanha": "Agendados de amanhã", novos: "Leads novos de hoje",
};

/** Escopo da tela que o drill-down leva junto: pessoa (`dono`) e origem real (`fonte`). */
export type LinkScope = { dono?: string | null; fonte?: string | null };
const href = (params: Record<string, string | undefined>, scope?: LinkScope) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, dono: scope?.dono ?? undefined, fonte: scope?.fonte ?? undefined })) if (v) q.set(k, v);
  return `/atendimento?${q}`;
};

export const lateHref = (scope?: LinkScope) => href({ filtro: "atrasados" }, scope);
export const waitingHref = (scope?: LinkScope) => href({ filtro: "esperando" }, scope);
export const staleHref = (stageKey?: string, scope?: LinkScope) => href({ filtro: "parados", etapa: stageKey }, scope);

/** Converte um link devolvido por `dailySummaryText` no destino que existe hoje; null quando não há lista para aquele filtro. */
export function summaryLinkHref(href: string): string | null {
  const url = new URL(href, "http://x");
  const filtro = url.searchParams.get("filtro");
  if (url.pathname === "/relatorios") return href;
  if (!filtro) return href;
  if (!parseQueueFilter(filtro)) return null;
  return `/atendimento?filtro=${filtro}`;
}
