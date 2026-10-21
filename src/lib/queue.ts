import { slaText } from "./alert-copy";
import { businessSecondsBetween, isOpen, type BusinessHours } from "./business-hours";

/** Vocabulário da Fila (/atendimento): módulo puro, usado pelo servidor e pelo navegador. */

export const QUEUE_VIEWS = ["todos", "meus", "sem-dono", "parados", "agendados-hoje", "clientes-ativos", "sem-contato-90d", "arquivadas", "equipe", "fornecedores", "nao-cliente"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const VIEW_LABEL: Record<QueueView, string> = {
  todos: "Todos", meus: "Minhas conversas", "sem-dono": "Sem dono", parados: "Parados", "agendados-hoje": "Agendados hoje",
  "clientes-ativos": "Clientes ativos", "sem-contato-90d": "Sem contato há 90 dias", arquivadas: "Resolvidas",
  equipe: "Equipe", fornecedores: "Fornecedores", "nao-cliente": "Spam",
};
/** Na URL a lista das resolvidas é `view=resolvidas` (antes `arquivadas` e `encerradas`, que ainda valem e a página redireciona). */
export const OLD_RESOLVED_VIEWS = ["arquivadas", "encerradas"] as const;
export const parseQueueView = (v: unknown): QueueView => (v === "resolvidas" || v === "encerradas" ? "arquivadas" : (QUEUE_VIEWS as readonly unknown[]).includes(v) ? (v as QueueView) : "todos");
/** Aba "Não lidas": conversas com mensagem da cliente que ninguém da Casa abriu (ver `deals.seen_at`). Combina com os filtros. */
export type QueueAba = "nao-lidas";
export const parseQueueAba = (v: unknown): QueueAba | null => (v === "nao-lidas" ? "nao-lidas" : null);

export type QueueSectionKey = "atrasados" | "perto" | "aguardando" | "acoes-hoje" | "parados" | "aguardando-cliente" | "reengajar" | "arquivadas";
export const SECTION_ORDER: QueueSectionKey[] = ["atrasados", "perto", "aguardando", "acoes-hoje", "parados", "aguardando-cliente", "reengajar", "arquivadas"];

/** Os números do resumo da Fila (chips). Parâmetro da própria Fila, não o `filtro` dos relatórios: mesmo escopo dos `counts`, sem "só os seus". */
export const QUEUE_FOCOS = ["aguardando", "atrasados", "combinados", "reclamacao", "evento", "retomar"] as const;
export type QueueFoco = (typeof QUEUE_FOCOS)[number];
export const parseQueueFoco = (v: unknown): QueueFoco | null => ((QUEUE_FOCOS as readonly unknown[]).includes(v) ? (v as QueueFoco) : null);
export const FOCO_LABEL: Record<QueueFoco, string> = { aguardando: "Conversas esperando resposta", atrasados: "Conversas atrasadas", combinados: "Combinados vencidos", reclamacao: "Reclamações", evento: "Eventos e noivas", retomar: "Para retomar" };

/** "Quase no prazo": a partir de 60% do prazo da etapa. A mesma regra na Fila, no Quadro, na Jornada, no cabeçalho, no WhyLate e no Hoje. */
export const NEAR_SLA_RATIO = 0.6;

/** Quanto do prazo já passou, de 0 a 1 (o anel de SLA); sem prazo ou sem espera, 0. */
export function slaProgress(waitSeconds: number, slaMinutes: number | null): number {
  if (!slaMinutes || slaMinutes <= 0 || waitSeconds <= 0) return 0;
  return Math.min(1, waitSeconds / (slaMinutes * 60));
}

export type SlaLevel = "none" | "ok" | "near" | "over" | "late";
/**
 * O estado do prazo: uma função só para todas as telas. `late` (vermelho) só existe com alerta de espera aberto. Passou do prazo
 * sem alerta ainda é `over` (dourado cheio): o alerta nasce no próximo ciclo do motor. `near` é a partir de NEAR_SLA_RATIO.
 */
export function slaLevel(o: { awaiting: boolean; alert: boolean; waitSeconds: number; slaMinutes: number | null }): SlaLevel {
  if (o.alert) return "late";
  if (!o.awaiting) return "none";
  if (!o.slaMinutes || o.slaMinutes <= 0) return "ok";
  const p = o.waitSeconds / (o.slaMinutes * 60);
  return p >= 1 ? "over" : p >= NEAR_SLA_RATIO ? "near" : "ok";
}

export type RingState = "none" | "ok" | "near" | "late";
/** As cores do anel, iguais na Fila, no Quadro, na Jornada e no cabeçalho. */
export const RING_COLOR: Record<RingState, string> = { none: "transparent", ok: "var(--color-graphite)", near: "var(--color-gold)", late: "var(--color-alert)" };

/** O anel: `late` é o alerta aberto (vermelho); passou do prazo sem alerta fica dourado (`near`). Ver `slaLevel`. */
export function ringState(opts: { awaiting: boolean; late: boolean; waitSeconds: number; slaMinutes: number | null }): RingState {
  const l = slaLevel({ awaiting: opts.awaiting, alert: opts.late, waitSeconds: opts.waitSeconds, slaMinutes: opts.slaMinutes });
  return l === "over" ? "near" : l;
}

/** Passou do prazo (com o alerta ou já além do prazo): o status Aberto fica vermelho. Casa fechada: o prazo não anda (só o alerta vale). */
export function lateNow(o: { alert: boolean; since: number | null; slaMinutes: number | null }, now: number, hours: BusinessHours): boolean {
  if (o.alert) return true;
  if (o.since == null || !o.slaMinutes || !isOpen(now, hours)) return false;
  return slaLevel({ awaiting: true, alert: false, waitSeconds: businessSecondsBetween(o.since, now, hours), slaMinutes: o.slaMinutes }) === "over";
}

/** O texto de prazo da linha (Fila, Hoje): um só, de `slaText`. Sem espera: null (quem chama escolhe outro texto). */
export function slaStatus(opts: { ring: RingState; alert: boolean; waitSeconds: number; slaMinutes: number | null }): { text: string; tone: "late" | "near" | "ok" } | null {
  if (opts.ring === "none") return null;
  return { text: slaText(opts.waitSeconds, opts.slaMinutes) ?? "Esperando resposta", tone: opts.ring === "late" ? "late" : opts.ring === "near" ? "near" : "ok" };
}

/** Os tipos de etapa que cada seção espera: fora deles, a linha mostra o nome da etapa no selo (ex.: um Agendado em "Esperando"). */
const EXPECTED_KINDS: Record<QueueSectionKey, readonly string[] | null> = {
  atrasados: ["lead", "atendimento"], perto: ["lead", "atendimento"], aguardando: ["lead", "atendimento"],
  "aguardando-cliente": ["lead", "atendimento", "followup", "proposta"], "acoes-hoje": ["lead", "atendimento", "followup", "proposta"], parados: ["lead", "atendimento", "followup", "proposta"],
  reengajar: null, arquivadas: null, // aqui a etapa não diz nada de novo: nunca aparece
};
export function offStage(section: QueueSectionKey, stageKind: string | null | undefined): boolean {
  const ok = EXPECTED_KINDS[section];
  return !!ok && !!stageKind && !ok.includes(stageKind);
}

export type QueueParams = { view?: string | null; /** Aba "Não lidas" (`nao-lidas`). */ aba?: string | null; foco?: string | null; filtro?: string | null; etapa?: string | null; dono?: string | null; fonte?: string | null; etiqueta?: string | null; /** Mais etiquetas (ids separados por vírgula), a regra delas (todas | qualquer | nao_tem) e os dias sem conversar. */ etiquetas?: string | null; regra?: string | null; dias?: string | null; q?: string | null; lead?: string | null };

/** Query string da Fila (sem o `?`), na ordem estável da URL; parâmetros vazios saem. */
export function queueQuery(p: QueueParams): string {
  const qs = new URLSearchParams();
  for (const k of ["view", "aba", "foco", "filtro", "etapa", "dono", "fonte", "etiqueta", "etiquetas", "regra", "dias", "q", "lead"] as const) if (p[k]) qs.set(k, k === "view" && (p[k] === "arquivadas" || p[k] === "encerradas") ? "resolvidas" : p[k]!);
  return qs.toString();
}
export const queueHref = (p: QueueParams) => { const q = queueQuery(p); return q ? `/atendimento?${q}` : "/atendimento"; };

/** A regra das etiquetas da URL (`regra=`): qualquer valor desconhecido vale "qualquer". */
export type EtiquetaRegra = "todas" | "qualquer" | "nao_tem";
export const parseEtiquetaRegra = (v: unknown): EtiquetaRegra => (v === "todas" || v === "nao_tem" ? v : "qualquer");
/** `dias=30` → 30; fora de 1 a 365 ou que não é número → null. */
export const parseDias = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null; };
