import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contactStats, contactTags, contacts, deals, professionals, salesItems, stages, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { contactFilterCounts, listContacts } from "./contacts";
import { CONTACT_FILTERS, type ContactFilter } from "../../lib/contact-list-params";
import { addDaysTo, returnInfo } from "../../lib/client-rhythm";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const HOJE = "2026-10-15";
let seq = 0;
/** Contato com a linha da visão por contato montada à mão (estes testes são da SQL da lista, não do recálculo). */
async function cliente(name: string, st: Partial<typeof contactStats.$inferInsert> = {}, extra: Partial<typeof contacts.$inferInsert> = {}) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+5571967${String(++seq).padStart(6, "0")}`, ...extra }).returning();
  await db.insert(contactStats).values({ contactId: c.id, ...st });
  return c.id;
}
const nomes = async (filter: ContactFilter) => (await listContacts({ filter, now: NOW, sort: "nome" })).rows.map((r) => r.name);
const visita = (diasAtras: number, ritmo = 40) => ({ visits: 5, lastVisitOn: addDaysTo(HOJE, -diasAtras), rhythmDays: ritmo });

beforeEach(async () => { seq = 0; await resetDb(); });

it("ficha e filtro concordam nas bordas (0,8×, 1,5×, 365 dias e horário a 181 dias)", async () => {
  const dias = [31, 32, 60, 61, 364, 365];
  for (const d of dias) await cliente(`Borda ${String(d).padStart(3, "0")}`, visita(d));
  const longe = await cliente("Borda Longe", visita(61));
  await db.insert(appointments).values({ contactId: longe, startsAt: new Date(NOW.getTime() + 181 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:longe" });
  const naHora = await nomes("na_hora"), sumidas = await nomes("sumidas");
  for (const d of dias) {
    const st = returnInfo({ lastVisitOn: addDaysTo(HOJE, -d), rhythmDays: 40, cycleDays: null, hasFuture: false }, HOJE)!.status;
    const nome = `Borda ${String(d).padStart(3, "0")}`;
    expect([d, naHora.includes(nome)]).toEqual([d, st === "na_hora"]);
    expect([d, sumidas.includes(nome)]).toEqual([d, st === "sumida"]);
  }
  expect(sumidas).toContain("Borda Longe"); // horário a 181 dias não conta
  expect(await nomes("com_horario")).not.toContain("Borda Longe");
});

it("cada botão filtra o que diz e a contagem bate com a lista", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const semana = await cliente("Aniversário Semana", {}, { birthDay: 22, birthMonth: 10 });
  await cliente("Aniversário Fora", {}, { birthDay: 23, birthMonth: 11 });
  const pacote = await cliente("Com Pacote");
  await db.insert(clientPackages).values([
    { contactId: pacote, packageName: "Hidratação 10x", totalSessions: 10, usedSessions: 3, validUntil: "2027-01-01", externalKey: "t:pk1" },
    { contactId: await cliente("Pacote Usado"), packageName: "Escova 4x", totalSessions: 4, usedSessions: 4, externalKey: "t:pk2" },
  ]);
  // Uma compra do Avec em 2 linhas (um serviço cada), com um serviço esgotado: a compra está esgotada (não é "com pacote").
  const comboUsado = await cliente("Combo Usado");
  await db.insert(clientPackages).values([4, 1].map((used, i) => ({ contactId: comboUsado, packageName: "Combo Método", serviceLabel: `S${i}`, totalSessions: 4, usedSessions: used,
    purchasedOn: "2026-01-10", validUntil: "2027-01-10", priceCents: 800000, externalKey: `t:cb${i}` })));
  const horario = await cliente("Com Horário", visita(70));
  await db.insert(appointments).values({ contactId: horario, startsAt: new Date(NOW.getTime() + 3 * 86_400_000), status: "confirmado", serviceLabel: "Corte", externalKey: "t:h1" });
  const semDono = await cliente("Sem Dono");
  await db.insert(deals).values({ contactId: semDono, stageId: lead.id });
  await db.insert(deals).values({ contactId: await cliente("Com Dona"), stageId: lead.id, ownerId: ana.id });
  await cliente("Uma Visita", { visits: 1, lastVisitOn: addDaysTo(HOJE, -200) });
  await cliente("Doze Visitas", { visits: 12, lastVisitOn: addDaysTo(HOJE, -5), rhythmDays: 30 });
  await cliente("Faltosa", { noShows: 2 });
  await cliente("Faltou Uma", { noShows: 1 });

  expect(await nomes("aniversario_semana")).toEqual(["Aniversário Semana"]);
  expect(await nomes("aniversario_mes")).toEqual(["Aniversário Semana"]);
  expect(await nomes("com_pacote")).toEqual(["Com Pacote"]);
  expect(await nomes("com_horario")).toEqual(["Com Horário"]);
  expect(await nomes("sumidas")).not.toContain("Com Horário"); // com horário marcado não é sumida
  expect(await nomes("sem_dono")).toEqual(["Sem Dono"]);
  expect(await nomes("nunca_voltou")).toEqual(["Uma Visita"]);
  expect(await nomes("vip")).toEqual(["Doze Visitas"]);
  expect(await nomes("faltosas")).toEqual(["Faltosa"]);
  const counts = await contactFilterCounts({ now: NOW });
  for (const f of CONTACT_FILTERS) expect([f, counts[f]]).toEqual([f, (await listContacts({ filter: f, now: NOW })).total]);
  void semana;
});

it("VIP também pelas 10% que mais gastaram", async () => {
  for (let i = 1; i <= 10; i++) await cliente(`Gasto ${String(i).padStart(2, "0")}`, { totalCents: i * 100_000, tickets: 1, visits: 1 });
  expect(await nomes("vip")).toEqual(["Gasto 09", "Gasto 10"]);
});

it("filtros em lista: profissional (ficha vale mais que a calculada), serviço já feito, etiqueta e origem; ordenação", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [luana] = await db.insert(professionals).values({ name: "LUANA" }).returning();
  const calc = await cliente("Calculada Maiara", { preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", visits: 3, lastVisitOn: addDaysTo(HOJE, -10) });
  await cliente("Escolhida Luana", { preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", visits: 8, lastVisitOn: addDaysTo(HOJE, -50) }, { preferredProfessionalId: luana.id });
  await db.insert(salesItems).values({ contactId: calc, soldOn: addDaysTo(HOJE, -10), item: "Progressiva", kind: "servico", externalKey: "t:s1" });
  const [noiva] = await db.insert(tags).values({ name: "Noiva" }).returning();
  const insta = await cliente("Veio Do Insta", { originLabel: "Instagram", visits: 1, lastVisitOn: addDaysTo(HOJE, -1) });
  await db.insert(contactTags).values({ contactId: insta, tagId: noiva.id });
  const so = async (o: object) => (await listContacts({ now: NOW, ...o })).rows.map((r) => r.name);
  expect(await so({ professionalId: maiara.id })).toEqual(["Calculada Maiara"]);
  expect(await so({ professionalId: luana.id })).toEqual(["Escolhida Luana"]);
  expect(await so({ service: "progressiva" })).toEqual(["Calculada Maiara"]);
  expect(await so({ tagId: noiva.id })).toEqual(["Veio Do Insta"]);
  expect(await so({ origin: "Instagram" })).toEqual(["Veio Do Insta"]);
  expect(await so({ sort: "ultima_visita" })).toEqual(["Veio Do Insta", "Calculada Maiara", "Escolhida Luana"]);
  expect(await so({ sort: "visitas" })).toEqual(["Escolhida Luana", "Calculada Maiara", "Veio Do Insta"]);
});

it("linha de contato só do WhatsApp (número oculto, sem nome, sem visita): frase sem NaN, -1, undefined ou lid:", async () => {
  const [c] = await db.insert(contacts).values({ name: null, phoneE164: "lid:5550001" }).returning();
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: c.id, stageId: lead.id, awaitingReplySince: new Date(NOW.getTime() - 5 * 60_000) });
  const [row] = (await listContacts({ now: NOW })).rows;
  expect(row).toMatchObject({ visits: 0, lastVisitOn: null, nextAppointmentAt: null, pkg: null, birthday: null, states: ["sem_dono"] });
  expect(row.situation).toBe("Sem dono · ainda não veio à Casa"); // a coluna usa a frase curta (a ficha mostra a inteira)
  expect(JSON.stringify(row)).not.toMatch(/NaN|undefined|há -\d/);
});
