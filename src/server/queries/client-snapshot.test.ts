import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, professionals, salesItems, salesPayments, stages, users, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { refreshContactStats } from "../domain/contact-stats";
import { getClientSnapshot } from "./client-snapshot";
import { clientContext } from "./client-context";

const NOW = new Date("2026-10-15T15:00:00Z");
const dia = (n: number) => new Date(Date.parse("2026-10-15T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
let seq = 0;
let rita = "";
const venda = (soldOn: string, o: Partial<typeof salesItems.$inferInsert> = {}) =>
  db.insert(salesItems).values({ contactId: rita, soldOn, item: "Escova", kind: "servico", totalCents: 20_000, comanda: String(++seq), externalKey: `t:v:${seq}`, ...o });

beforeEach(async () => {
  seq = 0;
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000201", birthDay: 17, birthMonth: 10 }).returning())[0].id;
});

it("cliente frequente do Avec: visitas > 0 e 'desde' antes de 2026 (nada de 'nenhuma registrada' nem 'primeira conversa')", async () => {
  await venda("2020-03-10"); await venda("2024-05-01"); await venda(dia(45));
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [d] = await db.insert(deals).values({ contactId: rita, stageId: lead.id }).returning();
  await refreshContactStats({ now: NOW });
  const x = await clientContext(rita, d.id, { money: false });
  expect(x.visits).toBe(3);
  expect(x.isFirstContact).toBe(false);
  expect(new Date(x.firstContactAt).getTime()).toBeLessThan(Date.parse("2026-01-01"));
  expect(x.lastVisit?.at.slice(0, 10)).toBe(dia(45));
});

it("sem 'ver valores', nenhum centavo sai do servidor (total, ticket, dívida, crédito)", async () => {
  await venda(dia(60)); await venda(dia(30));
  await db.insert(salesPayments).values([
    { contactId: rita, comanda: "9", paidOn: dia(30), method: "Dívida", valueCents: 4_000, externalKey: "t:p:1" },
    { contactId: rita, comanda: "8", paidOn: dia(20), method: "Crédito Cliente", valueCents: 1_000, externalKey: "t:p:2" },
  ]);
  await refreshContactStats({ now: NOW });
  const sem = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect([sem.stats.totalCents, sem.stats.ticketCents, sem.finance.debtCents, sem.finance.creditCents]).toEqual([null, null, null, null]);
  expect(sem.finance).toMatchObject({ debtCount: 1, creditCount: 1 }); // o aviso "tem dívida" continua, sem o valor
  expect(JSON.stringify(sem)).not.toMatch(/"(total|ticket|debt|credit|price)Cents":\s*\d/);
  const com = (await getClientSnapshot(rita, { money: true, now: NOW }))!;
  expect(com.stats).toMatchObject({ totalCents: 40_000, ticketCents: 20_000 });
  expect(com.finance).toMatchObject({ debtCents: 4_000, creditCents: 1_000 });
});

it("profissional preferida: a da ficha vale mais que a calculada; sem as duas, a anotada no Avec", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [gilvan] = await db.insert(professionals).values({ name: "GILVAN" }).returning();
  for (const n of [90, 60, 30]) await venda(dia(n), { professionalId: maiara.id, professionalName: "MAIARA" });
  await refreshContactStats({ now: NOW });
  expect((await getClientSnapshot(rita, { money: false, now: NOW }))!.preferred).toMatchObject({ id: maiara.id, name: "MAIARA", source: "calculada", share: 1 });
  await db.update(contacts).set({ preferredProfessionalId: gilvan.id }).where(eq(contacts.id, rita));
  expect((await getClientSnapshot(rita, { money: false, now: NOW }))!.preferred).toMatchObject({ id: gilvan.id, source: "ficha" });
  const [outra] = await db.insert(contacts).values({ name: "Fia Fictícia", phoneE164: "+5571966000202", importedFields: { avec: { comoConheceu: "CLIENTE GILVAN" } } }).returning();
  await refreshContactStats({ now: NOW });
  expect((await getClientSnapshot(outra.id, { money: false, now: NOW }))!.preferred).toMatchObject({ id: gilvan.id, name: "Gilvan", source: "avec" });
});

it("frase com horário, conversa aberta e dona; horário a mais de 180 dias não conta como próximo", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana Souza", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [espera] = await db.select().from(stages).where(eq(stages.key, "followup_1"));
  await db.insert(deals).values({ contactId: rita, stageId: espera.id, ownerId: ana.id, stageEnteredAt: new Date("2026-10-15T13:00:00Z") });
  await venda(dia(20));
  await db.insert(appointments).values({ contactId: rita, startsAt: new Date("2027-08-01T13:00:00Z"), status: "agendado", serviceLabel: "Escova", externalKey: "t:a:longe" });
  await refreshContactStats({ now: NOW });
  const longe = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect(longe.nextAppointment).toBeNull();
  expect(longe.situation.sentence).toBe("última visita há 20 dias · na etapa Aguardando cliente há 2 h com Ana · aniversário 17/10");
  await db.insert(appointments).values({ contactId: rita, startsAt: new Date("2026-10-16T17:00:00Z"), status: "confirmado", serviceLabel: "Escova", externalKey: "t:a:perto" });
  const perto = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect(perto.situation.sentence.startsWith("Tem horário amanhã 14:00")).toBe(true);
  expect(perto.conversation).toMatchObject({ stageName: "Aguardando cliente", ownerName: "Ana Souza" });
});

it("visita com várias profissionais: o painel lista todas; a assistente aparece como assistente (20/10)", async () => {
  const [thaise] = await db.insert(professionals).values({ name: "THAISE FIAES" }).returning();
  const [sidney] = await db.insert(professionals).values({ name: "SIDNEY", assistantOf: thaise.id }).returning();
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [v] = await db.insert(visits).values({ contactId: rita, day: "2026-10-16" }).returning();
  const at = new Date("2026-10-16T12:00:00Z");
  await db.insert(appointments).values([
    { contactId: rita, visitId: v.id, professionalId: thaise.id, startsAt: at, status: "confirmado", serviceLabel: "Coloração", externalKey: "t:v:1" },
    { contactId: rita, visitId: v.id, professionalId: sidney.id, startsAt: at, status: "confirmado", serviceLabel: "Coloração (apoio)", externalKey: "t:v:2" },
    { contactId: rita, visitId: v.id, professionalId: maiara.id, startsAt: new Date("2026-10-16T14:00:00Z"), status: "agendado", serviceLabel: "Escova", externalKey: "t:v:3" },
    { contactId: rita, visitId: v.id, professionalId: maiara.id, startsAt: at, status: "cancelado", serviceLabel: "Cancelado", externalKey: "t:v:4" },
  ]);
  const snap = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect(snap.nextVisit!.map((x) => [x.serviceLabel, x.professionalName, x.assistant])).toEqual([
    ["Coloração", "THAISE FIAES", false], ["Coloração (apoio)", "SIDNEY", true], ["Escova", "MAIARA", false],
  ]);
});
