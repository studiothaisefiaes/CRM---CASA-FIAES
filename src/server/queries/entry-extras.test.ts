import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { appointments, auditLog, clientLinks, clientNotes, contacts, professionals, users, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getEntryExtras } from "./entry-extras";

beforeEach(resetDb);

it("Finalizado por: a profissional que finalizou pelo app; finalizado pela recepção não mostra nome; ficha técnica e se dá para anotar", async () => {
  const [mu] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [cati] = await db.insert(users).values({ name: "Cati", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [p] = await db.insert(professionals).values({ name: "MAIARA", userId: mu.id }).returning();
  const [paula] = await db.insert(contacts).values({ name: "Paula", phoneE164: "+5571999990001" }).returning();
  const mk = async (k: string, contactId: string | null) => (await db.insert(appointments).values({ contactId, clientName: "Paula", professionalId: p.id, serviceLabel: "Corte",
    startsAt: new Date("2026-10-16T13:00:00Z"), status: "compareceu", origin: "crm", externalKey: k }).returning())[0];
  const a = await mk("t:1", paula.id), b = await mk("t:2", null);
  await db.insert(auditLog).values([
    { userId: mu.id, action: "agendamento_situacao", entity: "appointment", entityId: a.id, data: { de: "em_atendimento", para: "compareceu" } },
    { userId: cati.id, action: "agendamento_situacao", entity: "appointment", entityId: b.id, data: { de: "agendado", para: "compareceu" } },
  ]);
  await db.insert(clientNotes).values({ contactId: paula.id, authorId: cati.id, body: "Prefere água sem gás" });
  expect(await getEntryExtras(a.id)).toMatchObject({ finishedBy: "Maiara", canNote: true, notes: [expect.objectContaining({ body: "Prefere água sem gás", author: "Cati" })] });
  expect(await getEntryExtras(b.id)).toMatchObject({ finishedBy: null, notes: [], canNote: false });
});

it("o card diz o que a cliente fez pelo link e se dá para gerar o link", async () => {
  const now = new Date("2026-10-15T17:00:00Z"); // 14:00 em Salvador
  const [paula] = await db.insert(contacts).values({ name: "Paula", phoneE164: "+5571999990009" }).returning();
  const mk = async (k: string, o: Partial<typeof appointments.$inferInsert>) => (await db.insert(appointments).values({ contactId: paula.id, clientName: "Paula", serviceLabel: "Corte",
    startsAt: new Date("2026-10-16T13:00:00Z"), status: "agendado", origin: "crm", externalKey: k, ...o }).returning())[0];
  const conf = await mk("l:1", { status: "confirmado", confirmedVia: "link", confirmedAt: new Date("2026-10-15T13:42:00Z") });
  const canc = await mk("l:2", { status: "cancelado", cancelledVia: "link", cancelledAt: new Date("2026-10-15T14:05:00Z") });
  const passado = await mk("l:3", { startsAt: new Date("2026-10-15T12:00:00Z") });
  const [v] = await db.insert(visits).values({ contactId: paula.id, day: "2026-10-17" }).returning();
  const rem = await mk("l:4", { visitId: v.id, startsAt: new Date("2026-10-17T13:00:00Z") });
  await db.insert(clientLinks).values({ tokenHash: "h1", visitId: v.id, issuedStartsAt: rem.startsAt, createdVia: "conversa", expiresAt: new Date("2026-10-18T14:00:00Z"),
    lastAction: "pediu_remarcar", lastActionAt: new Date("2026-10-15T16:30:00Z") });
  expect((await getEntryExtras(conf.id, now)).link).toEqual({ activity: "Confirmou pelo link hoje 10:42", canCreate: true });
  expect((await getEntryExtras(canc.id, now)).link).toEqual({ activity: "Cancelou pelo link hoje 11:05", canCreate: false });
  expect((await getEntryExtras(passado.id, now)).link).toEqual({ activity: null, canCreate: false });
  expect((await getEntryExtras(rem.id, now)).link).toEqual({ activity: "Pediu para remarcar pelo link hoje 13:30", canCreate: true });
});
