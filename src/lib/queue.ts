import { seconds } from "./format";

/** Vocabulário da Fila (/atendimento): módulo puro, usado pelo servidor e pelo navegador. */

export const QUEUE_VIEWS = ["todos", "meus", "sem-dono", "parados", "agendados-hoje", "clientes-ativos", "sem-contato-90d"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const VIEW_LABEL: Record<QueueView, string> = {
  todos: "Todos", meus: "Meus leads", "sem-dono": "Sem dono", parados: "Parados", "agendados-hoje": "Agendados hoje",
  "clientes-ativos": "Clientes ativos", "sem-contato-90d": "Sem contato há 90 dias",
};
export const parseQueueView = (v: unknown): QueueView => ((QUEUE_VIEWS as readonly unknown[]).includes(v) ? (v as QueueView) : "todos");

export type QueueSectionKey = "atrasados" | "estourado" | "perto" | "aguardando" | "acoes-hoje" | "parados" | "aguardando-cliente" | "reengajar";
export const SECTION_ORDER: QueueSectionKey[] = ["atrasados", "estourado", "perto", "aguardando", "acoes-hoje", "parados", "aguardando-cliente", "reengajar"];
export const SECTION_LABEL: Record<QueueSectionKey, string> = {
  atrasados: "Atrasados", estourado: "Prazo estourado", perto: "Perto do prazo", aguardando: "Aguardando resposta", "acoes-hoje": "Próximas ações de hoje",
  parados: "Parados", "aguardando-cliente": "Aguardando a cliente", reengajar: "Para reengajar",
};

/** Os números do resumo da Fila (chips). Parâmetro da própria Fila, não o `filtro` dos relatórios: mesmo escopo dos `counts`, sem "só os seus". */
export const QUEUE_FOCOS = ["aguardando", "atrasados"] as const;
export type QueueFoco = (typeof QUEUE_FOCOS)[number];
export const parseQueueFoco = (v: unknown): QueueFoco | null => ((QUEUE_FOCOS as readonly unknown[]).includes(v) ? (v as QueueFoco) : null);
export const FOCO_LABEL: Record<QueueFoco, string> = { aguardando: "Leads esperando resposta", atrasados: "Leads atrasados" };

/** A partir de quanto do prazo da etapa o lead conta como "perto do prazo". */
export const NEAR_SLA_RATIO = 0.5;

/** Quanto do prazo já passou, de 0 a 1 (o anel de SLA); sem prazo ou sem espera, 0. */
export function slaProgress(waitSeconds: number, slaMinutes: number | null): number {
  if (!slaMinutes || slaMinutes <= 0 || waitSeconds <= 0) return 0;
  return Math.min(1, waitSeconds / (slaMinutes * 60));
}

export type RingState = "none" | "ok" | "near" | "late";

/**
 * Estado do anel. `late` vem do alerta de espera aberto (a mesma regra do sino) OU de já ter passado do prazo da etapa (o alerta só nasce no
 * próximo ciclo do motor; o anel e o texto não esperam por ele). A SEÇÃO da Fila segue o alerta (decisão da T15): isto só muda a cor e o texto.
 * `near` é acima de NEAR_SLA_RATIO do prazo.
 */
export function ringState(opts: { awaiting: boolean; late: boolean; waitSeconds: number; slaMinutes: number | null }): RingState {
  if (opts.late) return "late";
  if (!opts.awaiting) return "none";
  const p = slaProgress(opts.waitSeconds, opts.slaMinutes);
  return p >= 1 ? "late" : p >= NEAR_SLA_RATIO ? "near" : "ok";
}

/**
 * O texto de prazo da linha da Fila. Com alerta aberto: "atrasado 4 min". Passou do prazo sem alerta ainda: "prazo estourado há 4 min".
 * Perto: "perto do prazo · faltam 30 s". Dentro: "dentro do prazo". Sem espera: null (quem chama escolhe outro texto).
 */
export function slaStatus(opts: { ring: RingState; alert: boolean; waitSeconds: number; slaMinutes: number | null }): { text: string; tone: "late" | "near" | "ok" } | null {
  const sla = opts.slaMinutes ? opts.slaMinutes * 60 : 0;
  const over = sla ? opts.waitSeconds - sla : 0;
  if (opts.ring === "late") {
    if (opts.alert) return { text: over >= 60 ? `atrasado ${seconds(over)}` : "atrasado", tone: "late" };
    return { text: over > 0 ? `prazo estourado há ${seconds(over)}` : "prazo estourado agora", tone: "late" };
  }
  if (opts.ring === "near") return { text: sla - opts.waitSeconds > 0 ? `perto do prazo · faltam ${seconds(sla - opts.waitSeconds)}` : "no limite do prazo", tone: "near" };
  if (opts.ring === "ok") return { text: "dentro do prazo", tone: "ok" };
  return null;
}

export type QueueParams = { view?: string | null; foco?: string | null; filtro?: string | null; etapa?: string | null; dono?: string | null; fonte?: string | null; q?: string | null; lead?: string | null };

/** Query string da Fila (sem o `?`), na ordem estável da URL; parâmetros vazios saem. */
export function queueQuery(p: QueueParams): string {
  const qs = new URLSearchParams();
  for (const k of ["view", "foco", "filtro", "etapa", "dono", "fonte", "q", "lead"] as const) if (p[k]) qs.set(k, p[k]!);
  return qs.toString();
}
export const queueHref = (p: QueueParams) => { const q = queueQuery(p); return q ? `/atendimento?${q}` : "/atendimento"; };
