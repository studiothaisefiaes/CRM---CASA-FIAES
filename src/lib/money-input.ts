/** O valor que a recepção digita ("120", "120,50", "R$ 1.234,56") em centavos. Negativo ou texto: null. */
export function parseMoneyInput(text: string): number | null {
  const t = text.replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const moneyInputValue = (cents: number | null): string => (cents == null ? "" : (cents / 100).toFixed(2).replace(".", ","));
