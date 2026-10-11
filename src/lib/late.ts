export const BASE_TITLE = "Casa Fiaes";
const TZ = "America/Bahia";
const OUR_TITLE = /^\(\d+\) atrasados · /;

export const lateTitle = (n: number, original: string) => (n > 0 ? `(${n}) atrasados · ${BASE_TITLE}` : original);

/**
 * Título da aba para N atrasados. `docTitle` é o que o documento tem agora; `original` é o último título que NÃO era o nosso.
 * Só captura o original quando o título atual não é o nosso (senão 2 -> 1 -> 0 ficaria preso em "(1) atrasados").
 */
export function applyLateTitle(docTitle: string, n: number, original: string): { title: string; original: string } {
  const orig = OUR_TITLE.test(docTitle) ? original : docTitle;
  return { title: n > 0 ? lateTitle(n, orig) : orig || BASE_TITLE, original: orig };
}

export const lateAnnouncement = (n: number) => (n <= 0 ? "" : n === 1 ? "1 lead atrasado" : `${n} leads atrasados`);

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // AAAA-MM-DD no fuso da Casa

/** "até 03:28" (hoje), "até amanhã 03:28" ou "até sex 03:28", comparando o dia no fuso America/Bahia. */
export function quietUntilLabel(until: Date, now: Date = new Date()): string {
  const hm = until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000));
  const day = dayKey(until);
  if (day === today) return `até ${hm}`;
  if (day === tomorrow) return `até amanhã ${hm}`;
  const wd = until.toLocaleDateString("pt-BR", { weekday: "short", timeZone: TZ }).replace(".", "");
  return `até ${wd} ${hm}`;
}
