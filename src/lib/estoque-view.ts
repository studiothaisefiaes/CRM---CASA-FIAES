/** Quantidade de estoque em pt-BR (aceita 0,5 frasco; até 3 casas). */
export const qtyText = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
