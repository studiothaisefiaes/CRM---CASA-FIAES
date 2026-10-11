import type { Db } from "../src/server/db";
import { lists } from "../src/server/db/schema";

/**
 * Serviços SÓ para os testes (unitários e e2e). Em produção o seed não cria serviços: os nomes são os da Casa,
 * cadastrados pela gestão em Configurações › Listas › Serviços.
 */
export const TEST_SERVICES: { label: string; cycleDays?: number }[] = [
  { label: "Avaliação capilar" }, { label: "Tratamento de queda" }, { label: "Coloração", cycleDays: 35 }, { label: "Corte" }, { label: "Hidratação", cycleDays: 30 },
];
export async function seedTestServices(db: Db) {
  await db.insert(lists).values(TEST_SERVICES.map((s, position) => ({ kind: "service" as const, label: s.label, position, cycleDays: s.cycleDays ?? null }))).onConflictDoNothing();
}
