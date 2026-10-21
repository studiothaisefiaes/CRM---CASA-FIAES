import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, appointments, clientNotes, clientPackages, contacts, lists, professionals, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import type { WorkHours } from "@/lib/work-hours";
import { clientCard, getProAppointment, getProDay, getProWeek, resolvePro, type ProContext } from "./pro";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-16", "09:00"); // sexta
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
let k = 0;
let maiara: ProContext;
let biaId = "", paula = "", corte = "";

const ap = async (o: Partial<typeof appointments.$inferInsert> = {}) =>
  (await db.insert(appointments).values({ serviceLabel: "Corte feminino", clientName: "PAULA SOUZA", status: "agendado", origin: "crm", externalKey: `t:${++k}`,
    startsAt: bahia("2026-10-16", "10:00"), professionalId: maiara.professionalId, contactId: paula, ...o }).returning())[0];
const blk = (o: Partial<typeof agendaBlocks.$inferInsert>) =>
  db.insert(agendaBlocks).values({ title: "Almoço", startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "12:00", endTime: "13:00", externalKey: `crm:blq:t${++k}`, origin: "crm", ...o });

beforeEach(async () => {
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: CASA });
  const [u] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(professionals).values({ name: "MAIARA", userId: u.id });
  biaId = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  maiara = (await resolvePro(u.id))!;
  paula = (await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001", email: "paula@x.com", birthDay: 20, birthMonth: 10 }).returning())[0].id;
  corte = (await db.insert(lists).values({ kind: "service", label: "Corte feminino", durationMin: 80 }).returning())[0].id;
});

describe("o dia da profissional", () => {
  it("só os horários dela, sem cancelado, lista de espera ou gêmeo; duração do horário, senão do serviço, senão vazia", async () => {
    const a1 = await ap({ startsAt: bahia("2026-10-16", "10:00"), serviceId: corte });
    const a2 = await ap({ startsAt: bahia("2026-10-16", "14:00"), durationMin: 45 });
    const a3 = await ap({ startsAt: bahia("2026-10-16", "16:00") });
    await ap({ startsAt: bahia("2026-10-16", "11:00"), status: "cancelado" });
    await ap({ startsAt: bahia("2026-10-16", "12:00"), status: "espera" });
    await ap({ startsAt: bahia("2026-10-16", "10:00"), avecTwinOf: a1.id, origin: "avec" });
    await ap({ startsAt: bahia("2026-10-16", "10:00"), professionalId: biaId, clientName: "OUTRA CLIENTE", contactId: null });
    await ap({ startsAt: bahia("2026-10-17", "10:00") });
    const d = await getProDay(maiara, "2026-10-16");
    expect(d.items.map((i) => [i.id, i.durationMin, i.start])).toEqual([[a1.id, 80, 600], [a2.id, 45, 840], [a3.id, null, 960]]);
    expect(d.items[0]).toMatchObject({ clientName: "Paula Souza", service: "Corte feminino", status: "agendado" });
    expect(d.ranges).toEqual([[540, 1080]]);
  });

  it("nunca devolve telefone nem e-mail da cliente", async () => {
    await ap();
    expect(JSON.stringify(await getProDay(maiara, "2026-10-16"))).not.toMatch(/99999|paula@x\.com/);
  });

  it("bloqueio dela e de todas aparecem; pedido de folga aparece aguardando; recusado, apagado e de outra somem", async () => {
    await blk({ professionalId: maiara.professionalId });
    await blk({ professionalId: null, title: "Reunião", startTime: "08:00", endTime: "08:30" });
    await blk({ professionalId: maiara.professionalId, title: "Folga", startTime: "14:00", endTime: "18:00", requestStatus: "pedido" });
    await blk({ professionalId: maiara.professionalId, title: "Curso", startTime: "15:00", endTime: "16:00", requestStatus: "recusado" });
    await blk({ professionalId: maiara.professionalId, title: "Apagado", deletedAt: new Date() });
    await blk({ professionalId: biaId, title: "Da Bia" });
    expect((await getProDay(maiara, "2026-10-16")).blocks.map((b) => [b.title, b.start, b.end, b.pending])).toEqual([
      ["Reunião", 480, 510, false], ["Almoço", 720, 780, false], ["Folga (aguardando a recepção)", 840, 1080, true],
    ]);
  });

  it("segunda com a Casa fechada e sem horário próprio: nenhuma faixa (a tela mostra Folga)", async () => {
    expect((await getProDay(maiara, "2026-10-19")).ranges).toEqual([]);
  });

  it("com horário próprio na segunda, vale o dela", async () => {
    const own = { "0": null, "1": [["10:00", "14:00"]], "2": null, "3": null, "4": null, "5": null, "6": null } as WorkHours;
    await db.update(professionals).set({ workHours: own }).where(eq(professionals.id, maiara.professionalId));
    const m2 = (await resolvePro(maiara.userId))!;
    expect((await getProDay(m2, "2026-10-19")).ranges).toEqual([[600, 840]]);
    expect((await getProDay(m2, "2026-10-16")).ranges).toEqual([]);
  });

  it("horário de outra profissional, gêmeo do Avec ou id inválido: não encontrado (posse)", async () => {
    const mine = await ap();
    const hers = await ap({ professionalId: biaId });
    const twin = await ap({ avecTwinOf: mine.id, origin: "avec" });
    expect((await getProAppointment(maiara, mine.id, NOW))?.id).toBe(mine.id);
    expect(await getProAppointment(maiara, hers.id, NOW)).toBeNull();
    expect(await getProAppointment(maiara, twin.id, NOW)).toBeNull();
    expect(await getProAppointment(maiara, "nao-e-uuid", NOW)).toBeNull();
  });

  it("cartão da cliente: ficha técnica (não as notas do contato), última visita sem valor, pacote, primeira vez e aniversário", async () => {
    await db.update(contacts).set({ notes: "assunto da conversa: não mostrar" }).where(eq(contacts.id, paula));
    const [autora] = await db.insert(users).values({ name: "Cati Recepção", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning();
    await db.insert(clientNotes).values({ contactId: paula, authorId: autora.id, body: "Alérgica a amônia" });
    const at = bahia("2026-10-16", "10:00").toISOString();
    expect(await clientCard({ contactId: paula, startsAt: at }, NOW)).toMatchObject({ firstVisit: true, lastVisit: null, pkg: null, birthdayThisWeek: true });
    await ap({ startsAt: bahia("2026-08-12", "15:00"), serviceLabel: "Luzes", status: "compareceu", professionalId: biaId, priceCents: 45000 });
    await db.insert(clientPackages).values({ contactId: paula, packageName: "Combo Método", totalSessions: 4, usedSessions: 2, externalKey: "pk:t1" });
    const card = await clientCard({ contactId: paula, startsAt: at }, NOW);
    expect(card).toMatchObject({ firstVisit: false, lastVisit: "12/08 · Luzes com a Bia", pkg: "Combo Método · 2 de 4 sessões", birthdayThisWeek: true });
    expect(card.notes.map((n) => [n.body, n.author, n.hasPhoto])).toEqual([["Alérgica a amônia", "Cati", false]]);
    expect(JSON.stringify(card)).not.toMatch(/assunto da conversa|45000|450,00/);
  });

  it("cartão da cliente: pacote do Avec em várias linhas (uma por serviço) é um pacote só, com as sessões da compra", async () => {
    const combo = { contactId: paula, packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: "2025-12-09", validUntil: "2099-12-09" };
    await db.insert(clientPackages).values([
      { ...combo, serviceLabel: "Sessão de pacote metodo", usedSessions: 0, externalKey: "pk:c1" },
      { ...combo, serviceLabel: "Finalização Metodo Fiaes", usedSessions: 2, externalKey: "pk:c2" },
    ]);
    expect((await clientCard({ contactId: paula, startsAt: bahia("2026-10-16", "10:00").toISOString() }, NOW)).pkg).toBe("Combo Manutenção Método Fiaes · 2 de 4 sessões");
  });

  it("cartão da cliente: pacote cancelado no caixa do CRM não aparece", async () => {
    await db.insert(clientPackages).values({ contactId: paula, packageName: "Combo Cancelado", totalSessions: 4, usedSessions: 0, externalKey: "pk:t2", cancelledAt: NOW });
    expect((await clientCard({ contactId: paula, startsAt: bahia("2026-10-16", "10:00").toISOString() }, NOW)).pkg).toBeNull();
  });

  it("semana: 7 dias a partir de hoje, com o número de clientes (faltou não conta) e a folga", async () => {
    await ap({ startsAt: bahia("2026-10-16", "10:00") });
    await ap({ startsAt: bahia("2026-10-16", "14:00") });
    await ap({ startsAt: bahia("2026-10-17", "09:00"), status: "faltou" });
    await ap({ startsAt: bahia("2026-10-17", "10:00") });
    expect((await getProWeek(maiara, "2026-10-16")).map((d) => [d.day, d.clients, d.off])).toEqual([
      ["2026-10-16", 2, false], ["2026-10-17", 1, false], ["2026-10-18", 0, true], ["2026-10-19", 0, true],
      ["2026-10-20", 0, false], ["2026-10-21", 0, false], ["2026-10-22", 0, false],
    ]);
  });
});
