/** Vocabulário da Fila (/atendimento): módulo puro, usado pelo servidor e pelo navegador. */

export const QUEUE_VIEWS = ["todos", "meus", "sem-dono", "parados", "agendados-hoje", "clientes-ativos", "sem-contato-90d"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const VIEW_LABEL: Record<QueueView, string> = {
  todos: "Todos", meus: "Meus leads", "sem-dono": "Sem dono", parados: "Parados", "agendados-hoje": "Agendados hoje",
  "clientes-ativos": "Clientes ativos", "sem-contato-90d": "Sem contato há 90 dias",
};
export const parseQueueView = (v: unknown): QueueView => ((QUEUE_VIEWS as readonly unknown[]).includes(v) ? (v as QueueView) : "todos");

export type QueueSectionKey = "atrasados" | "perto" | "aguardando" | "acoes-hoje" | "parados" | "aguardando-cliente";
export const SECTION_ORDER: QueueSectionKey[] = ["atrasados", "perto", "aguardando", "acoes-hoje", "parados", "aguardando-cliente"];
export const SECTION_LABEL: Record<QueueSectionKey, string> = {
  atrasados: "Atrasados", perto: "Perto do prazo", aguardando: "Aguardando resposta", "acoes-hoje": "Próximas ações de hoje",
  parados: "Parados", "aguardando-cliente": "Aguardando a cliente",
};

/** A partir de quanto do prazo da etapa o lead conta como "perto do prazo". */
export const NEAR_SLA_RATIO = 0.5;

/** Quanto do prazo já passou, de 0 a 1 (o anel de SLA); sem prazo ou sem espera, 0. */
export function slaProgress(waitSeconds: number, slaMinutes: number | null): number {
  if (!slaMinutes || slaMinutes <= 0 || waitSeconds <= 0) return 0;
  return Math.min(1, waitSeconds / (slaMinutes * 60));
}

export type RingState = "none" | "ok" | "near" | "late";

/**
 * Estado do anel. `late` vem do alerta de espera aberto (a mesma regra do sino); `near` é acima de NEAR_SLA_RATIO do prazo.
 * Passou do prazo sem alerta ainda (o motor roda de tempos em tempos) segue como `near`, nunca como "atrasado".
 */
export function ringState(opts: { awaiting: boolean; late: boolean; waitSeconds: number; slaMinutes: number | null }): RingState {
  if (opts.late) return "late";
  if (!opts.awaiting) return "none";
  return slaProgress(opts.waitSeconds, opts.slaMinutes) >= NEAR_SLA_RATIO ? "near" : "ok";
}

export type QueueParams = { view?: string | null; filtro?: string | null; etapa?: string | null; dono?: string | null; fonte?: string | null; q?: string | null; lead?: string | null };

/** Query string da Fila (sem o `?`), na ordem estável da URL; parâmetros vazios saem. */
export function queueQuery(p: QueueParams): string {
  const qs = new URLSearchParams();
  for (const k of ["view", "filtro", "etapa", "dono", "fonte", "q", "lead"] as const) if (p[k]) qs.set(k, p[k]!);
  return qs.toString();
}
export const queueHref = (p: QueueParams) => { const q = queueQuery(p); return q ? `/atendimento?${q}` : "/atendimento"; };
