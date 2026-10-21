import { AVAILABILITY_LABEL, type Availability } from "./availability";

export type TransferPerson = { id: string; name: string; availability: string; priorityLevel: number; waiting: number };

const ORDER: Record<string, number> = { disponivel: 0, pausa: 1, ausente: 2 };

/** Opções do "Transferir para…": disponíveis primeiro (menos esperando antes), depois em pausa e ausentes; sem a dona atual. */
export function transferOptions(people: TransferPerson[], ownerId: string | null) {
  return people.filter((p) => p.id !== ownerId)
    .sort((a, b) => (ORDER[a.availability] ?? 3) - (ORDER[b.availability] ?? 3) || a.waiting - b.waiting || a.name.localeCompare(b.name, "pt-BR"))
    .map((p) => {
      const state = AVAILABILITY_LABEL[p.availability as Availability] ?? "Ausente";
      return { id: p.id, label: p.name, detail: p.availability === "disponivel" ? `${state} · ${p.waiting} esperando` : state };
    });
}
