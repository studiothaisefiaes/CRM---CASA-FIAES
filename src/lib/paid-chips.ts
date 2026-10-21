import type { PaidFilter } from "@/server/domain/caixa/paid";

/** Filtros da aba "Já pagaram" (7.9): módulo puro, usado pela página (servidor) e pela lista (cliente). */
export type PaidChip = "sem_horario" | "vence_30" | "pacote" | "credito";
export const PAID_CHIPS: { value: PaidChip; label: string }[] = [
  { value: "sem_horario", label: "Sem horário marcado" }, { value: "vence_30", label: "Vence em 30 dias" }, { value: "pacote", label: "Pacote" }, { value: "credito", label: "Crédito" },
];
export function paidFilterOf(chip: PaidChip | null, withValues: boolean): PaidFilter {
  if (chip === "sem_horario") return { semHorario: true, withValues };
  if (chip === "vence_30") return { venceEm30: true, withValues };
  if (chip === "pacote" || chip === "credito") return { tipo: chip, withValues };
  return { withValues };
}
