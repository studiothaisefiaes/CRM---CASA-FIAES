/**
 * A origem gravada na conversa (`deals.origin`) como aparece na tela. O valor no banco não muda (é chave de filtro e de varredura);
 * só o nome que saiu da tela ganha o nome novo ("um nome para cada coisa", 17/10).
 */
const RENAMED: Record<string, string> = { "Retorno sugerido": "Hora de voltar" };

/** Opções de filtro por origem: o rótulo é o da tela, o valor é o gravado (filtrar continua achando as conversas e as clientes). */
export const originOptions = (origins: readonly string[]) => origins.map((o) => ({ value: o, label: originLabel(o) }));

export function originLabel<T extends string | null | undefined>(origin: T): T | string {
  return origin ? RENAMED[origin] ?? origin : origin;
}
