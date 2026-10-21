import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, deals, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";
import { applyScheduledMigration, planScheduledMigration, undoScheduledMigration } from "./migrate-scheduled";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

/** Um lead em Agendado com o horário só no lead (como antes do 6B). */
async function leadAgendado(name: string, startsAt: Date | null, over: Partial<typeof deals.$inferInsert> = {}) {
  const c = await cliente(name, { stage: "agendado" });
  await db.update(deals).set({ scheduledAt: startsAt, serviceId: s.corte.id, professionalId: s.ana.id, ...over }).where(eq(deals.id, c.dealId!));
  return c;
}

it("ensaio: o futuro entra; o que já passou e o que já está na agenda ficam de fora, com o motivo; arquivado e sem horário nem aparecem", async () => {
  const futuro = await leadAgendado("Paula Souza", bahia(16, 10), { attendance: "confirmado", attendanceAt: bahia(15, 8) });
  await leadAgendado("Rita Lima", bahia(14, 10));
  const naAgenda = await leadAgendado("Lia Souza", bahia(17, 10));
  await ap({ startsAt: bahia(17, 10), contactId: naAgenda.contactId, professionalId: s.ana.id });
  await leadAgendado("Arquivada", bahia(18, 10), { archivedAt: NOW });
  await leadAgendado("Sem Hora", null);
  const plan = await planScheduledMigration(NOW);
  expect(plan.items).toEqual([expect.objectContaining({
    dealId: futuro.dealId, contactId: futuro.contactId, clientName: "Paula Souza", startsAt: bahia(16, 10).toISOString(), serviceLabel: "Corte",
    professionalId: s.ana.id, durationMin: 60, status: "confirmado", confirmedAt: bahia(15, 8).toISOString(),
  })]);
  expect(plan.skipped.map((x) => [x.clientName, x.reason])).toEqual([["Rita Lima", "passou"], ["Lia Souza", "ja_na_agenda"]]);
  expect(await db.select().from(appointments)).toHaveLength(1); // o ensaio não grava
});

it("aplicar cria o horário do CRM ligado ao lead, com visita; conflito entra como encaixe; rodar de novo não duplica", async () => {
  const paula = await leadAgendado("Paula Souza", bahia(16, 10));
  await ap({ startsAt: bahia(16, 10), clientName: "Outra Cliente", professionalId: s.ana.id }); // do Avec, outra cliente, mesma hora
  const r = await applyScheduledMigration(await planScheduledMigration(NOW), NOW);
  expect(r).toMatchObject({ fitIn: 1, skipped: 0 });
  const [a] = await db.select().from(appointments).where(eq(appointments.id, r.createdIds[0]));
  expect(a).toMatchObject({ origin: "crm", dealId: paula.dealId, contactId: paula.contactId, status: "agendado", fitIn: true, externalKey: `crm:${a.id}` });
  expect((await db.select().from(visits).where(eq(visits.id, a.visitId!)))[0]).toMatchObject({ day: "2026-10-16", contactId: paula.contactId });
  const again = await planScheduledMigration(NOW);
  expect(again.items).toEqual([]);
  expect((await applyScheduledMigration({ ...again, items: (await planScheduledMigration(NOW)).items }, NOW)).createdIds).toEqual([]);
});

it("desfazer tira só o que ninguém mexeu; o mexido fica e é contado", async () => {
  await leadAgendado("Paula Souza", bahia(16, 10));
  await leadAgendado("Rita Lima", bahia(16, 14));
  const { createdIds } = await applyScheduledMigration(await planScheduledMigration(NOW), NOW);
  await db.update(appointments).set({ updatedBy: s.cati.id }).where(eq(appointments.id, createdIds[1]));
  expect(await undoScheduledMigration(createdIds)).toEqual({ removed: 1, kept: 1 });
  expect((await db.select().from(appointments)).map((x) => x.id)).toEqual([createdIds[1]]);
  expect(await db.select().from(visits)).toHaveLength(1); // a visita que ficou vazia sai junto
});
