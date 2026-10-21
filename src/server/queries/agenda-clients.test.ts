import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts, salesItems } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia } from "../../../test/agenda-fixtures";
import { clientAgenda, searchAgendaClients } from "./agenda-clients";

beforeEach(async () => { await resetDb(); });

it("busca por nome ou telefone, com a última visita (CRM ou Avec); quem estava como 'Não é cliente' vem por último", async () => {
  const [paula] = await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571988000101" }).returning();
  await db.insert(contacts).values({ name: "Paulo Lima", phoneE164: "+5571988000102", ignored: true });
  await ap({ startsAt: bahia(10, 10), contactId: paula.id, status: "compareceu" });
  await db.insert(salesItems).values({ contactId: paula.id, soldOn: "2026-10-12", item: "Corte", kind: "servico", externalKey: "t:venda" });
  expect((await searchAgendaClients("pau")).map((h) => [h.name, h.lastVisit, h.ignored])).toEqual([["Paula Souza", "2026-10-12", false], ["Paulo Lima", null, true]]);
  expect((await searchAgendaClients("0101")).map((h) => h.id)).toEqual([paula.id]);
  expect(await searchAgendaClients("p")).toEqual([]);
});

it("a agenda de uma cliente: próximos, anteriores e cancelados, sem gêmeos nem lista de espera", async () => {
  const [c] = await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571988000101" }).returning();
  const now = bahia(15, 9);
  const futuro = await ap({ startsAt: bahia(20, 10), contactId: c.id });
  await ap({ startsAt: bahia(20, 10), contactId: c.id, avecTwinOf: futuro.id });
  const passado = await ap({ startsAt: bahia(10, 10), contactId: c.id, status: "compareceu" });
  const cancelado = await ap({ startsAt: bahia(18, 10), contactId: c.id, status: "cancelado" });
  await ap({ startsAt: bahia(22, 0), contactId: c.id, status: "espera" });
  const r = await clientAgenda(c.id, now);
  expect([r.futuros.map((x) => x.appointmentId), r.passados.map((x) => x.appointmentId), r.cancelados.map((x) => x.appointmentId)]).toEqual([[futuro.id], [passado.id], [cancelado.id]]);
  expect(r.futuros[0]).toMatchObject({ day: "2026-10-20", serviceLabel: "Corte" });
});
