import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, lists, professionalServices } from "../../db/schema";
import { addServiceItemPort, caixaOn, openComandaPort } from "../agenda/ports";
import { serviceTermsFor } from "../service-terms";

export type ComandaFeed = "alimentada" | "desligada" | "falhou";

/**
 * Finalizar no app, com o caixa no CRM: põe o serviço do horário na comanda aberta da visita, criando a comanda se precisar
 * (`added_via = 'profissional'`). "Fez algo a mais?" acrescenta serviços DELA com o preço do cadastro (0084: o próprio dela, senão o do
 * serviço); sem preço, a recepção completa.
 * Com o caixa no Avec, não toca na comanda. Falhar aqui nunca desfaz o Finalizar: a tela pede para avisar a recepção.
 */
export async function feedComandaFromPro(i: { appointmentId: string; professionalId: string; actorId: string; extraServiceIds: string[] }): Promise<ComandaFeed> {
  if (!(await caixaOn())) return "desligada";
  try {
    const [a] = await db.select({ serviceId: appointments.serviceId, label: appointments.serviceLabel, price: appointments.priceCents })
      .from(appointments).where(eq(appointments.id, i.appointmentId));
    if (!a) return "falhou";
    // Já numa comanda viva (aberta ou paga antes, 7.9): não cobra de novo.
    const billed = async () => (await db.execute(sql`select 1 from comanda_items ci join comandas c on c.id = ci.comanda_id
      where ci.appointment_id = ${i.appointmentId} and ci.cancelled_at is null and c.status <> 'cancelada' limit 1`)).rows.length > 0;
    const extras = i.extraServiceIds.length
      ? await db.select({ id: lists.id, label: lists.label }).from(professionalServices).innerJoin(lists, eq(lists.id, professionalServices.serviceId))
        .where(and(eq(professionalServices.professionalId, i.professionalId), inArray(professionalServices.serviceId, i.extraServiceIds)))
      : [];
    if (!extras.length && (await billed())) return "alimentada";
    const comandaId = await openComandaPort(i.appointmentId, i.actorId);
    const added: string[] = [];
    if (!(await billed())) {
      added.push(await addServiceItemPort({ comandaId, serviceId: a.serviceId, label: a.label, professionalId: i.professionalId, appointmentId: i.appointmentId, unitCents: a.price ?? (a.serviceId ? (await serviceTermsFor(db, a.serviceId, i.professionalId)).priceCents : null), actorId: i.actorId }));
    }
    for (const s of extras) {
      const unitCents = (await serviceTermsFor(db, s.id, i.professionalId)).priceCents;
      added.push(await addServiceItemPort({ comandaId, serviceId: s.id, label: s.label, professionalId: i.professionalId, appointmentId: null, unitCents, actorId: i.actorId }));
    }
    // Quem lançou: a profissional (o item deste horário, mesmo quando a comanda nova juntou os horários da visita, e os "a mais").
    await db.execute(sql`update comanda_items set added_via = 'profissional' where comanda_id = ${comandaId} and appointment_id = ${i.appointmentId} and cancelled_at is null`);
    for (const id of added) await db.execute(sql`update comanda_items set added_via = 'profissional' where id = ${id}`);
    return "alimentada";
  } catch (e) {
    console.error("[app da profissional] comanda não alimentada", e);
    return "falhou";
  }
}
