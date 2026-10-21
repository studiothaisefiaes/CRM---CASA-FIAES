import type { CloseDayStep } from "@/components/fechar-dia/close-day";

/** O passo em que abrir (r66 #17): o primeiro com pendência; sem nenhuma, o do caixa. */
export const firstPendingStep = (noOutcome: number, comandas: number): CloseDayStep => (noOutcome > 0 ? 1 : comandas > 0 ? 2 : 3);

/** Uma linha: o que falta antes de fechar (ou que não falta nada). */
export function pendingSummary(noOutcome: number, comandas: number): string {
  const parts = [noOutcome > 0 ? `${noOutcome} ${noOutcome === 1 ? "horário sem desfecho" : "horários sem desfecho"}` : null, comandas > 0 ? `${comandas} ${comandas === 1 ? "comanda aberta" : "comandas abertas"}` : null].filter(Boolean);
  return parts.length ? `Falta: ${parts.join(" e ")}.` : "Nada pendente: pode fechar o caixa.";
}

