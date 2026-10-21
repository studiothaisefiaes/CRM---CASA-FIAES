import { dayOf } from "./agenda";

/**
 * Na Casa (pedido do dono, 15/10): a cliente está no salão. Regra única para o funil (etapa Na Casa) e para o Hoje ("Na Casa agora").
 * A visita de HOJE está em andamento quando um horário dela está com Chegou ou Em atendimento, ou quando um já foi finalizado e outro
 * da mesma visita ainda vai acontecer (visita com 2 serviços só sai quando o último termina). Sem visita, cada horário é a própria visita.
 */
export const IN_HOUSE_STATUSES: readonly string[] = ["chegou", "em_atendimento"];
export const STILL_TO_DO_STATUSES: readonly string[] = ["agendado", "confirmado"];
/** Os status que a consulta precisa trazer para decidir. */
export const NA_CASA_LOOKUP_STATUSES: string[] = [...IN_HOUSE_STATUSES, ...STILL_TO_DO_STATUSES, "compareceu"];

type Appt = { id: string; visitId: string | null; status: string; startsAt: Date };

/** As visitas de hoje em andamento, cada uma com os horários em ordem de início (gêmeos do Avec já devem vir de fora). */
export function inHouseVisits<T extends Appt>(rows: readonly T[], now: Date): T[][] {
  const today = dayOf(now);
  const byVisit = new Map<string, T[]>();
  for (const a of [...rows].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    if (dayOf(a.startsAt) !== today) continue;
    const k = a.visitId ?? a.id;
    byVisit.set(k, [...(byVisit.get(k) ?? []), a]);
  }
  return [...byVisit.values()].filter((v) =>
    v.some((a) => IN_HOUSE_STATUSES.includes(a.status)) ||
    (v.some((a) => a.status === "compareceu") && v.some((a) => STILL_TO_DO_STATUSES.includes(a.status))));
}

/** O horário "de agora" da visita: o que está acontecendo (Em atendimento, Chegou) ou, entre dois serviços, o próximo. */
export function currentOf<T extends Appt>(visit: readonly T[]): T {
  return visit.find((a) => a.status === "em_atendimento") ?? visit.find((a) => a.status === "chegou")
    ?? visit.find((a) => STILL_TO_DO_STATUSES.includes(a.status)) ?? visit[0];
}
