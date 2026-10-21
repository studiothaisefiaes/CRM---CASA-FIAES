import { STATUS_LABEL, type AgendaStatus } from "@/lib/agenda";
import { cn } from "@/lib/cn";

export const CHIP: Record<AgendaStatus, string> = {
  agendado: "bg-gold-soft text-gold-ink",
  confirmado: "bg-ok-soft text-ok",
  conferir: "bg-alert-soft text-alert",
  compareceu: "bg-ok-soft text-ok",
  faltou: "bg-paper-3 text-alert",
  remarcou: "bg-info-soft text-graphite",
  perdido: "bg-paper-3 text-muted",
  cancelado: "bg-paper-3 text-muted",
  solicitado: "bg-info-soft text-graphite", chegou: "bg-gold-soft text-gold-ink", em_atendimento: "bg-ink text-paper",
};
/** Borda do card (Semana e Profissionais): a mesma cor da situação. */
export const EDGE: Record<AgendaStatus, string> = {
  agendado: "border-l-gold", confirmado: "border-l-ok", conferir: "border-l-alert", compareceu: "border-l-ok",
  faltou: "border-l-line-strong", remarcou: "border-l-line-strong", perdido: "border-l-line-strong", cancelado: "border-l-line-strong",
  solicitado: "border-l-line-strong", chegou: "border-l-gold", em_atendimento: "border-l-ink",
};
/** Situação em uma palavra dentro do card pequeno (agendado não precisa dizer). */
export const MINI: Partial<Record<AgendaStatus, string>> = {
  confirmado: "text-ok", conferir: "text-alert", compareceu: "text-ok", faltou: "text-alert", cancelado: "text-muted",
  solicitado: "text-graphite", chegou: "text-gold-ink", em_atendimento: "text-ink",
};

export function StatusChip({ status }: { status: AgendaStatus }) {
  return <span className={cn("inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium", CHIP[status])}>{STATUS_LABEL[status]}</span>;
}

/** "Avec": marca discreta de que o horário veio do relatório do Avec. */
export function AvecTag({ className }: { className?: string }) {
  return <span title="Veio do Avec" className={cn("inline-flex h-5 shrink-0 items-center rounded-[6px] border border-line-strong px-1.5 text-xs font-semibold text-muted", className)}>Avec</span>;
}
