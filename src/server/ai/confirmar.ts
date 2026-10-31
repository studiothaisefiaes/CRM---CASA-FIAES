import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, appointments, deals, lists, messages } from "../db/schema";
import { cancelAppointments, createVisit } from "../domain/agenda/visits";
import type { Actor } from "../domain/agenda/actor";
import { serviceTermsFor } from "../domain/service-terms";
import { slotMs } from "@/lib/schedule";
import type { ProposedSlot } from "@/lib/proposed-slot";
import { bookingFromSuggestion } from "./suggest";
import { UserFacingError } from "../domain/errors";

const plain = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Palavras que indicam outro serviço na mesma visita, mesmo sem bater com o nome cadastrado ("complementos", "Tratamento + Finalização"). */
const OUTROS = /\b(complementos?|tratamentos?|finalizac|escovas?|hidratac|botox|progressiva)|\+/;

/**
 * A conversa fala de mais de um serviço? Caso Izaura (30/10): "coloração com Jackson, tratamento e finalização". Na dúvida, sim: a folha
 * abre e a atendente confere. Palavra que já está no nome do serviço do horário não conta; nome de outro serviço conta pela primeira palavra.
 */
export function maisDeUmServico(textos: string[], slotLabel: string | null, labels: string[]): boolean {
  const t = plain(textos.join(" "));
  const proprio = plain(slotLabel ?? "");
  const achou = [...t.matchAll(new RegExp(OUTROS.source, "g"))].some((m) => m[0] === "+" || !proprio.includes(m[0].slice(0, 6)));
  if (achou) return true;
  return labels.some((l) => {
    const w = plain(l).split(/[^a-z0-9]+/).find((x) => x.length >= 5);
    return !!w && !proprio.includes(w) && new RegExp(`\\b${w}\\b`).test(t);
  });
}

export type Confirmar = { marcado: true; appointmentIds: string[] } | { marcado: false; motivo: string; slot: ProposedSlot; livre: boolean | null; confirm: string };

/**
 * "Confirmar e marcar" (Cati 30/10). Só marca sem a folha com o horário combinado, livre, profissional e serviço conhecidos, tempo cadastrado
 * e um serviço só: nunca reserva 1 h inventada para uma coloração de 4 h. O id da sugestão é a chave do pedido: dois toques marcam uma vez.
 */
export async function confirmarEMarcar(id: string, dealId: string, actor: Actor, now = new Date()): Promise<Confirmar | null> {
  const b = await bookingFromSuggestion(id, dealId, now);
  if (!b) return null;
  const { slot, livre, confirm } = b;
  const nao = (motivo: string): Confirmar => ({ marcado: false, motivo, slot, livre, confirm });
  if (slot.origem !== "combinado") return nao("Esse horário ainda não foi combinado com a cliente.");
  if (!slot.professionalId || !slot.serviceId) return nao("Falta dizer a profissional ou o serviço.");
  if (livre !== true) return nao("Esse horário não está mais livre.");
  const terms = await serviceTermsFor(db, slot.serviceId, slot.professionalId);
  if (terms.durationMin == null) return nao(`${slot.serviceLabel ?? "Esse serviço"} está sem tempo cadastrado.`);
  const [[sug], recentes, servicos, [deal]] = await Promise.all([
    db.select({ sugestao: aiSuggestions.sugestao }).from(aiSuggestions).where(eq(aiSuggestions.id, id)),
    db.select({ body: messages.body, transcript: messages.transcript }).from(messages).where(eq(messages.dealId, dealId)).orderBy(desc(messages.createdAt)).limit(4),
    db.select({ label: lists.label }).from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true))),
    db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId)),
  ]);
  const textos = [sug?.sugestao ?? "", ...recentes.map((m) => m.body ?? m.transcript ?? "")];
  if (maisDeUmServico(textos, slot.serviceLabel, servicos.map((s) => s.label))) return nao("A conversa fala de mais de um serviço.");
  const r = await createVisit({ requestKey: id, client: { contactId: deal!.contactId }, dealId, startsAt: new Date(slotMs(slot.day, slot.time)).toISOString(),
    items: [{ serviceId: slot.serviceId, professionalId: slot.professionalId, preference: "escolhida" }] }, actor, now);
  return { marcado: true, appointmentIds: r.appointmentIds };
}

/** Desfazer: só horários da cliente desta conversa. */
export async function desfazerMarcacao(dealId: string, ids: string[], actor: Actor, now = new Date()): Promise<void> {
  const [deal] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  const rows = ids.length ? await db.select({ id: appointments.id, contactId: appointments.contactId }).from(appointments).where(inArray(appointments.id, ids)) : [];
  if (!deal || rows.some((r) => r.contactId !== deal.contactId)) throw new UserFacingError("Horário não encontrado.");
  for (const r of rows) await cancelAppointments({ appointmentId: r.id, reason: "engano", via: "recepcao" }, actor, now);
}
