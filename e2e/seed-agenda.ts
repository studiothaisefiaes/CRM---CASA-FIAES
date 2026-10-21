import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../src/server/db";
import { lists, professionals, professionalServices } from "../src/server/db/schema";

type WorkHoursValue = (typeof professionals.$inferInsert)["workHours"];
/** 9h às 18h todos os dias: o e2e não depende do dia da semana em que roda. */
export const E2E_WORK_HOURS = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["09:00", "18:00"]]])) as WorkHoursValue;

/**
 * Agenda do e2e do 6B, por cima do reset do 6A (modo dupla, Corte 60 min, Maiara 9h–18h fazendo Corte, Bia seguindo a Casa 24 h):
 * Corte a R$ 120,00, Hidratação com 45 min e R$ 90,00, "Carla" (9h–18h todo dia) e as três fazendo Corte e Hidratação.
 */
export async function seedAgendaE2E(db: Db) {
  await db.update(lists).set({ priceCents: 12000 }).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte")));
  await db.update(lists).set({ durationMin: 45, priceCents: 9000 }).where(and(eq(lists.kind, "service"), eq(lists.label, "Hidratação")));
  await db.insert(professionals).values({ name: "Carla", workHours: E2E_WORK_HOURS, agendaPosition: 3 });
  const svc = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "service"), inArray(lists.label, ["Corte", "Hidratação"])));
  const pros = await db.select({ id: professionals.id }).from(professionals).where(inArray(professionals.name, ["Maiara", "Bia", "Carla"]));
  await db.insert(professionalServices).values(pros.flatMap((p) => svc.map((x) => ({ professionalId: p.id, serviceId: x.id })))).onConflictDoNothing();
}
