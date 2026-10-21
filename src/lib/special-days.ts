/** Dia especial: feriado (`window` null = Casa fechada) ou horário reduzido. `text` = resposta própria fora do horário nesse dia. */
export type SpecialDay = { day: string /* AAAA-MM-DD */; window: [string, string] | null; text: string | null };

export function especiaisOf(days: SpecialDay[]): Record<string, [string, string] | null> {
  return Object.fromEntries(days.map((d) => [d.day, d.window]));
}

/** "2026-12-25" -> "25/12" */
export const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
