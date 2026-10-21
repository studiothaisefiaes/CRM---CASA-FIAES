/**
 * Repetir o horário (Fase C, item 23a): os limites da Casa ficam em Configurações › Agenda e caixa › Repetir horário (settings `repetir`).
 * Padrão do plano: até 12 semanas entre uma vez e outra, até 26 vezes. Na configuração, de 1 a 52 semanas e de 2 a 104 vezes (o CHECK do banco).
 */
export type RepetirConfig = { maxSemanas: number; maxVezes: number };
export const REPETIR_PADRAO: RepetirConfig = { maxSemanas: 12, maxVezes: 26 };
export const REPETIR_TETO: RepetirConfig = { maxSemanas: 52, maxVezes: 104 };
export const REPETIR_MIN_VEZES = 2;

export const semanasText = (max: number) => `Escolha de 1 a ${max} semanas.`;
export const vezesText = (max: number) => `Escolha de ${REPETIR_MIN_VEZES} a ${max} vezes.`;

type Skipped = { day: string; reason: string };
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** "8 marcados. 2 não couberam: 12/11 (Ana já tem…), 26/11 (…)". */
export function repeatResultText(created: number, skipped: Skipped[]): string {
  const ok = `${created} ${created === 1 ? "marcado" : "marcados"}.`;
  if (!skipped.length) return ok;
  return `${ok} ${skipped.length} ${skipped.length === 1 ? "não coube" : "não couberam"}: ${skipped.map((x) => `${ddmm(x.day)} (${x.reason.replace(/\.$/, "")})`).join(", ")}`;
}
