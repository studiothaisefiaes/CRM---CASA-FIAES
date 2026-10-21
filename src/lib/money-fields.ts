/** Campos do lead que são dinheiro: só quem vê valores ou registra venda edita (o servidor confere). */
export const MONEY_PATCH_FIELDS = ["valueCents", "paidCents", "paymentMethod", "chargeAt"] as const;
export const touchesMoney = (patch: Record<string, unknown>) => MONEY_PATCH_FIELDS.some((k) => patch[k] !== undefined);
