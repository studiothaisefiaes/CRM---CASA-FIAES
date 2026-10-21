/** Vale, bônus e desconto na comissão: nomes de tela e formas dos dados (puro: serve ao servidor e à tela). */
export type AdjustmentKind = "vale" | "bonus" | "desconto";
export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ["vale", "bonus", "desconto"];
export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = { vale: "Vale", bonus: "Bônus", desconto: "Desconto na comissão" };

export type AdjustmentRow = {
  id: string; professionalId: string; professionalName: string; kind: AdjustmentKind; valueCents: number; day: string; note: string; ruleId: string | null;
  fromSangria: boolean; paid: boolean; cancelledAt: string | null; createdByName: string | null;
};
export type AdjustmentRuleRow = { id: string; professionalId: string; professionalName: string; kind: AdjustmentKind; valueCents: number; dayOfMonth: number; startsOn: string; endsOn: string | null; note: string; active: boolean };
