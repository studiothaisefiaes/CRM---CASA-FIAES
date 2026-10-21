import { peopleOnNumber, type PeopleOnNumber, type PersonOnNumber } from "../domain/people-on-number";
import { nextAppointmentsOf } from "./avec";

export type NumberPersonNext = PersonOnNumber & {
  /** O próximo horário DELA (agendado ou confirmado, daqui para a frente); null sem horário marcado. */
  next: { id: string; startsAt: string; serviceLabel: string; professionalName: string | null } | null;
};
export type NumberPeopleNext = Omit<PeopleOnNumber, "people"> & { people: NumberPersonNext[] };

/**
 * As pessoas do número com o próximo horário de cada uma, para o painel da conversa (21/10, Cati: "mãe e filha com o mesmo telefone:
 * só uma aparece; as duas têm horário"). A conversa é do titular; o horário de cada pessoa continua na ficha dela.
 * Só o titular no número: nada de consulta de horários (o painel já mostra o dele).
 */
export async function numberPeopleWithNext(contactId: string, now = new Date()): Promise<NumberPeopleNext | null> {
  const p = await peopleOnNumber(contactId);
  if (!p) return null;
  const next = p.people.length > 1 ? await nextAppointmentsOf(p.people.map((x) => x.id), now) : new Map();
  return {
    ...p,
    people: p.people.map((x) => {
      const a = next.get(x.id);
      return { ...x, next: a ? { id: a.id, startsAt: a.startsAt, serviceLabel: a.serviceLabel, professionalName: a.professionalName } : null };
    }),
  };
}
