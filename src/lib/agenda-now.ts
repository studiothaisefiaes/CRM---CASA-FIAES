/** A hora inicial do Marcar (a faixa "Agora" saiu na nova Agenda de 16/10: atrasadas viraram "sem baixa" nas pendências). Pura. */
import { minuteOfDay, todayBahia } from "./agenda";
import { hhmm } from "./free-slots";
/** Hora inicial do Marcar: hoje, a próxima meia hora (no máximo 23:30); outro dia, 09:00. */
export function defaultBookingTime(day: string, nowMs: number): string {
  if (day !== todayBahia(new Date(nowMs))) return "09:00";
  return hhmm(Math.min(23 * 60 + 30, Math.ceil((minuteOfDay(new Date(nowMs)) + 1) / 30) * 30));
}
