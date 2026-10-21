/**
 * Cédulas e moedas do Real para o fechamento do caixa (Norte Vendas, lib/cashDenominations.ts): contar por cédula erra menos e deixa
 * registrado como se chegou ao total. Em centavos; R$ 0,01 incluído como no Norte.
 */
export const CASH_DENOMINATIONS_CENTS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1] as const;

/** Soma da contagem ({"20000": 2} = duas notas de R$ 200). Cédula desconhecida e quantidade negativa ou quebrada não contam. */
export function sumDenominations(counts: Record<string, number>): number {
  return CASH_DENOMINATIONS_CENTS.reduce((total, cents) => {
    const n = counts[String(cents)];
    return total + (Number.isInteger(n) && n > 0 ? n * cents : 0);
  }, 0);
}

/** "R$ 200", "R$ 1", "R$ 0,25". */
export const denominationLabel = (cents: number): string =>
  cents >= 100 && cents % 100 === 0 ? `R$ ${cents / 100}` : `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
