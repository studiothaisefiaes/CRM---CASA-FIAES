import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, professionals, salesItems } from "../db/schema";
import { mergeVisitDays, type VisitDay } from "../../lib/visit-days";
import { FUTURE_HORIZON_DAYS, bahiaDay } from "../../lib/client-rhythm";
import { isUuid } from "../../lib/uuid";

export const VISITS_LIMIT = 300;

/** Visitas passadas e futuras (até 180 dias) com profissional, situação e a observação do horário; valores só com `withValues`. */
export async function getContactVisits(contactId: string, opts: { withValues: boolean; now?: Date }): Promise<VisitDay[]> {
  if (!isUuid(contactId)) return [];
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + FUTURE_HORIZON_DAYS * 86_400_000);
  const [appts, items] = await Promise.all([
    db.select({ id: appointments.id, startsAt: appointments.startsAt, status: appointments.status, serviceLabel: appointments.serviceLabel, professionalName: professionals.name, notes: appointments.notes })
      .from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(and(eq(appointments.contactId, contactId), ne(appointments.status, "espera"), lte(appointments.startsAt, horizon)))
      .orderBy(desc(appointments.startsAt)).limit(VISITS_LIMIT),
    db.select({
      id: salesItems.id, soldOn: salesItems.soldOn, item: salesItems.item, totalCents: salesItems.totalCents, fromPackage: salesItems.fromPackage,
      professionalName: sql<string | null>`coalesce(${professionals.name}, ${salesItems.professionalName})`,
    }).from(salesItems).leftJoin(professionals, eq(professionals.id, salesItems.professionalId))
      .where(and(eq(salesItems.contactId, contactId), lte(salesItems.soldOn, bahiaDay(horizon.getTime()))))
      .orderBy(desc(salesItems.soldOn)).limit(VISITS_LIMIT),
  ]);
  return mergeVisitDays(
    appts.map((a) => ({ ...a, startsAt: a.startsAt.toISOString() })),
    items.map((i) => ({ ...i, totalCents: opts.withValues ? i.totalCents : null })),
    bahiaDay(now.getTime()),
  );
}
