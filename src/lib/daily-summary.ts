/** A regra do resumo do dia no Hoje: puro (servidor e testes), com `now` injetável e sempre no relógio de Salvador. */
export const SUMMARY_HOUR = 19;
const TZ = "America/Bahia";

/** A hora (0 a 23) em Salvador. `hour12: false` pode devolver "24" à meia-noite, daí o `% 24`. */
export const localHour = (now: Date): number => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now)) % 24;

/** A partir das 19h o resumo é "do dia", aberto e em destaque; antes disso é "até agora", recolhido. */
export function summaryMode(now: Date): { highlight: boolean; title: string } {
  const highlight = localHour(now) >= SUMMARY_HOUR;
  return { highlight, title: highlight ? "Resumo do dia" : "Resumo até agora" };
}
