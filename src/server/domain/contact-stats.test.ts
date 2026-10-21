import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, contactStats, contacts, deals, lists, professionals, salesItems, salesPayments, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { refreshContactStats } from "./contact-stats";
import { applyAvecFiles } from "./avec/apply";
import { buildXlsx, readXlsx } from "./avec/xlsx";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
/** "aaaa-mm-dd" de n dias antes de hoje (negativo = depois). */
const dia = (n: number) => new Date(Date.parse("2026-10-15T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
/** O instante de n dias antes, ao meio-dia de Salvador. */
const hora = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let seq = 0;
const cliente = async (name = "Cliente Fictícia", extra: Partial<typeof contacts.$inferInsert> = {}) =>
  (await db.insert(contacts).values({ name, phoneE164: `+5571966${String(++seq).padStart(6, "0")}`, ...extra }).returning())[0];
const venda = (contactId: string, soldOn: string, o: Partial<typeof salesItems.$inferInsert> = {}) =>
  db.insert(salesItems).values({ contactId, soldOn, item: "Corte Feminino", kind: "servico", totalCents: 10_000, externalKey: `t:venda:${++seq}`, ...o });
const horario = (contactId: string, startsAt: Date, status: string, o: Partial<typeof appointments.$inferInsert> = {}) =>
  db.insert(appointments).values({ contactId, startsAt, status, serviceLabel: "Escova", externalKey: `t:horario:${++seq}`, ...o });
const stats = async (contactId: string) => (await db.select().from(contactStats).where(eq(contactStats.contactId, contactId)))[0];

beforeEach(async () => { seq = 0; await resetDb(); });

it("visitas = dias distintos com comparecimento, comanda ou Compareceu no CRM (o mesmo dia conta uma vez)", async () => {
  const c = await cliente("Rita Fictícia");
  await horario(c.id, hora(40), "compareceu");
  await venda(c.id, dia(40)); // a mesma visita
  await venda(c.id, dia(20));
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  await db.insert(deals).values({ contactId: c.id, stageId: fechado.id, attendance: "compareceu", attendanceAt: hora(5), closedAt: hora(5) });
  await horario(c.id, hora(10), "faltou");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 3, firstVisitOn: dia(40), lastVisitOn: dia(5), noShows: 1 });
});

it("ritmo = mediana dos intervalos com 3+ visitas; retorno = última visita + ritmo; com 2 visitas vale o ciclo do serviço", async () => {
  const a = await cliente("Ana Fictícia");
  for (const n of [130, 90, 50, 20]) await venda(a.id, dia(n)); // intervalos 40, 40, 30 → mediana 40
  const b = await cliente("Bia Fictícia");
  await db.insert(lists).values({ kind: "service", label: "Progressiva Lote2 Teste", cycleDays: 90, position: 90 });
  await venda(b.id, dia(100), { item: "Progressiva Lote2 Teste" });
  await venda(b.id, dia(30), { item: "Progressiva Lote2 Teste" });
  await refreshContactStats({ now: NOW });
  expect(await stats(a.id)).toMatchObject({ visits: 4, rhythmDays: 40, cycleDays: null, returnDueOn: dia(-20) });
  expect(await stats(b.id)).toMatchObject({ visits: 2, rhythmDays: null, cycleDays: 90, returnDueOn: dia(-60) });
});

it("profissional preferida: 3+ serviços e 60%+ com a mesma (guarda a parte); abaixo disso, nenhuma", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const fiel = await cliente("Carla Fictícia");
  await venda(fiel.id, dia(90), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(fiel.id, dia(60), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(fiel.id, dia(30), { professionalName: "LUANA" });
  const dividida = await cliente("Dora Fictícia");
  await venda(dividida.id, dia(90), { professionalName: "LUANA" });
  await venda(dividida.id, dia(60), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(dividida.id, dia(30), { professionalName: "JOANA" });
  await refreshContactStats({ now: NOW });
  expect(await stats(fiel.id)).toMatchObject({ preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", serviceCount: 3 });
  expect((await stats(fiel.id)).preferredShare).toBeCloseTo(0.67, 2);
  expect(await stats(dividida.id)).toMatchObject({ preferredProfessionalId: null, preferredProfessionalName: null, serviceCount: 3 });
});

it("os 3 serviços mais feitos, do mais feito ao menos (empate: o mais recente primeiro)", async () => {
  const c = await cliente();
  for (const [n, item] of [[100, "Escova"], [90, "Escova"], [80, "Corte"], [70, "Hidratação"], [60, "Manicure"], [50, "Hidratação"]] as const) await venda(c.id, dia(n), { item });
  await refreshContactStats({ now: NOW });
  expect((await stats(c.id)).topServices).toEqual([{ item: "Hidratação", n: 2 }, { item: "Escova", n: 2 }, { item: "Manicure", n: 1 }]);
});

it("'Como conheceu' do Avec vira a origem; 'CLIENTE GILVAN' vira a dica de profissional; sem Avec, a origem do primeiro lead", async () => {
  const insta = await cliente("Eva Fictícia", { importedFields: { avec: { comoConheceu: "INSTAGRAM" } } });
  const gilvan = await cliente("Fia Fictícia", { importedFields: { avec: { comoConheceu: "CLIENTE GILVAN" } } });
  const crm = await cliente("Gal Fictícia");
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: crm.id, stageId: lead.id, sourceLabel: "Indicação", createdAt: hora(3) });
  await refreshContactStats({ now: NOW });
  expect(await stats(insta.id)).toMatchObject({ originLabel: "Instagram", avecProfessionalHint: null });
  expect(await stats(gilvan.id)).toMatchObject({ originLabel: null, avecProfessionalHint: "Gilvan" });
  expect(await stats(crm.id)).toMatchObject({ originLabel: "Indicação" });
});

it("faltas, cancelamentos e os lançamentos de Dívida e Crédito Cliente do Avec", async () => {
  const c = await cliente();
  await horario(c.id, hora(30), "faltou");
  await horario(c.id, hora(20), "faltou");
  await horario(c.id, hora(10), "cancelado");
  await db.insert(salesPayments).values([
    { contactId: c.id, comanda: "1", paidOn: dia(30), method: "Dívida", valueCents: 5_000, externalKey: "t:pag:1" },
    { contactId: c.id, comanda: "2", paidOn: dia(10), method: "DIVIDA", valueCents: 2_500, externalKey: "t:pag:2" },
    { contactId: c.id, comanda: "3", paidOn: dia(5), method: "Crédito Cliente", valueCents: 7_000, externalKey: "t:pag:3" },
    { contactId: c.id, comanda: "4", paidOn: dia(5), method: "Pix", valueCents: 9_000, externalKey: "t:pag:4" },
  ]);
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ noShows: 2, cancellations: 1, debtCents: 7_500, debtCount: 2, lastDebtOn: dia(10), creditCents: 7_000, creditCount: 1 });
});

it("datas absurdas do Avec (compareceu em 2923, venda em 4676) não viram visita, última visita nem ritmo", async () => {
  const c = await cliente();
  await venda(c.id, dia(60));
  await venda(c.id, dia(30));
  await horario(c.id, new Date("2923-05-10T13:00:00Z"), "compareceu");
  await venda(c.id, "4676-01-01");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 2, lastVisitOn: dia(30), rhythmDays: null, totalCents: 20_000 });
});

it("contato sem nenhum dado tem linha com zeros (a lista e a ficha não quebram)", async () => {
  const c = await cliente("Sem Nada Fictícia");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 0, lastVisitOn: null, rhythmDays: null, topServices: [], debtCents: 0, originLabel: null });
});

it("duas recalculadas ao mesmo tempo (importação + noite): sem erro e uma linha por contato", async () => {
  for (let i = 0; i < 5; i++) await venda((await cliente(`Cliente${i} Fictícia`)).id, dia(10 + i));
  await Promise.all([refreshContactStats({ now: NOW }), refreshContactStats({ now: NOW })]);
  const [r] = (await db.execute(sql`select count(*)::int as n, (select count(*)::int from contacts) as total from contact_stats`)).rows as { n: number; total: number }[];
  expect(r.n).toBe(r.total);
});

it("importar um relatório do Avec recalcula a visão por contato", async () => {
  const c = await cliente("Rita Fictícia", { phoneE164: "+5571988880001" });
  const rows = await readXlsx(await buildXlsx([
    ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
    ["01/10/2026 10:00", "20/10/2026", "09:30", "Rita Fictícia", 71988880001, "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "Gosta de franja curta", "", "", "Recepção"],
  ]));
  const r = await applyAvecFiles([{ fileName: "reservas.xlsx", rows }], { now: NOW });
  expect(r.visao?.contatos).toBeGreaterThanOrEqual(1);
  expect(await stats(c.id)).toBeDefined(); // a linha só existe se a recalculada rodou depois da importação
});
