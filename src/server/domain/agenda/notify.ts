import { emit } from "../events";

/** Depois do commit: a Agenda (e o app da profissional, 7A) recarrega os dias tocados; a Fila, as conversas que mudaram de etapa. */
export async function afterAgendaChange(days: Iterable<string>, dealIds: Iterable<string> = []) {
  for (const day of new Set(days)) await emit("agenda_alterada", { day });
  for (const dealId of new Set(dealIds)) await emit("etapa_alterada", { dealId });
}
