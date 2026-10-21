import { bahiaDay } from "./client-rhythm";

/** Visitas da ficha (Lote 2): horários (Avec ou CRM) e itens de comanda do mesmo dia numa linha só. Puro. */
export type VisitAppointment = { id: string; startsAt: string; status: string; serviceLabel: string; professionalName: string | null; notes: string | null };
export type VisitItem = { id: string; soldOn: string; item: string; professionalName: string | null; totalCents: number | null; fromPackage: boolean };
export type VisitDay = { day: string; future: boolean; appointments: VisitAppointment[]; items: VisitItem[]; totalCents: number | null };

export const VISIT_STATUS_LABEL: Record<string, string> = {
  agendado: "Marcado", confirmado: "Confirmado", compareceu: "Atendida", faltou: "Faltou", cancelado: "Cancelado",
};

/** Futuros primeiro (o mais perto em cima), depois os passados (o mais recente em cima). Hoje conta como passado. */
export function mergeVisitDays(appts: VisitAppointment[], items: VisitItem[], today: string): VisitDay[] {
  const byDay = new Map<string, VisitDay>();
  const get = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, future: day > today, appointments: [], items: [], totalCents: null }));
    return d;
  };
  for (const a of appts) get(bahiaDay(Date.parse(a.startsAt))).appointments.push(a);
  for (const i of items) {
    const d = get(i.soldOn);
    d.items.push(i);
    if (i.totalCents != null) d.totalCents = (d.totalCents ?? 0) + i.totalCents;
  }
  for (const d of byDay.values()) d.appointments.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
  const all = [...byDay.values()];
  return [...all.filter((d) => d.future).sort((a, b) => a.day.localeCompare(b.day)), ...all.filter((d) => !d.future).sort((a, b) => b.day.localeCompare(a.day))];
}
