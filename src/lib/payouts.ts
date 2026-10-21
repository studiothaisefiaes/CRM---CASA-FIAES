/** Pagar a comissão (Fase A, Tarefa 9): formas dos dados do "A pagar", do recibo e da lista de Pagas, e o texto do período. Puro. */
import type { AdjustmentKind } from "./adjustments";

export type PayableLine = { kind: "item" | "assistente"; id: string; day: string; comandaNumber: number; clientName: string; label: string; commissionCents: number };
export type PayableAdjustment = { id: string; kind: AdjustmentKind; day: string; valueCents: number; note: string };
export type PayablePending = { day: string; label: string; why: "sem_regra" | "sem_valor_sessao" | "aguardando_quitacao" };
export type PayableTotals = { commissionCents: number; bonusCents: number; valesCents: number; descontosCents: number; netCents: number };

/** O que falta pagar a uma profissional até `untilDay` (`fromDay` = o dia mais antigo que entra; vazio = nada). */
export type Payable = {
  professionalId: string; name: string; fromDay: string | null; untilDay: string;
  lines: PayableLine[]; adjustments: PayableAdjustment[]; pending: PayablePending[]; totals: PayableTotals;
};

/** O recibo: o `Payable` congelado no pagamento, com o número, quando e quem pagou e o saldo levado ao próximo. */
export type PayoutReceipt = Payable & {
  id: string; number: number; paidAt: string; paidByName: string | null; carriedCents: number; cancelledAt: string | null; cancelReason: string | null; note: string | null;
};

export type PayoutRow = {
  id: string; number: number; professionalId: string; professionalName: string; fromDay: string | null; untilDay: string; netCents: number; carriedCents: number;
  paidAt: string; paidByName: string | null; cancelledAt: string | null; cancelReason: string | null;
};

/** Comissões + bônus − vales − descontos. Passando do que entra, o recibo sai com R$ 0 e a diferença é levada (`carriedCents`). */
export function payoutTotals(lines: { commissionCents: number }[], adjustments: { kind: AdjustmentKind; valueCents: number }[]): PayableTotals & { carriedCents: number } {
  const sum = (k: AdjustmentKind) => adjustments.filter((a) => a.kind === k).reduce((s, a) => s + a.valueCents, 0);
  const commissionCents = lines.reduce((s, l) => s + l.commissionCents, 0);
  const bonusCents = sum("bonus"), valesCents = sum("vale"), descontosCents = sum("desconto");
  const raw = commissionCents + bonusCents - valesCents - descontosCents;
  return { commissionCents, bonusCents, valesCents, descontosCents, netCents: Math.max(0, raw), carriedCents: Math.max(0, -raw) };
}

/** "dd/mm/aaaa". */
export const brDate = (day: string) => day.split("-").reverse().join("/");
/** "20/09/2026 a 30/09/2026" ou, sem início, "até 30/09/2026". */
export const periodText = (fromDay: string | null, untilDay: string) => (fromDay ? `${brDate(fromDay)} a ${brDate(untilDay)}` : `até ${brDate(untilDay)}`);
