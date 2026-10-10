/** Alerta mínimo de que o "atrasado" precisa (o AlertItem do sino satisfaz). */
export type LateAlert = { dealId: string | null; type: string; resolved: boolean };

export const BASE_TITLE = "Casa Fiaes";

/** Quantos leads estão com a espera vencida: um por lead, só alerta de espera ainda aberto. */
export function countLate(alerts: LateAlert[]): number {
  const deals = new Set<string>();
  for (const a of alerts) if (a.type === "sem_resposta_minutos" && !a.resolved && a.dealId) deals.add(a.dealId);
  return deals.size;
}

/** "Cruzou o limite": o número de atrasados subiu. Nunca no primeiro render (prev nulo), nunca em refresh igual. A T21 troca pela primitiva final. */
export const crossedUp = (prev: number | null, next: number) => prev !== null && next > prev;

export const lateTitle = (n: number, original: string) => (n > 0 ? `(${n}) atrasados · ${BASE_TITLE}` : original);

export const lateAnnouncement = (n: number) => (n <= 0 ? "" : n === 1 ? "1 lead atrasado" : `${n} leads atrasados`);
