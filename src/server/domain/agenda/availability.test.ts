import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, appointments, contacts, deals, lists, professionals, professionalServices, settings, stages } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { checkStartFor, dayRulesFor, nextFreeSlots } from "./availability";

// Casa: terça a sábado, 9h–18h. 19/10/2026 é segunda; 20/10, terça; 22/10, quinta; 31/10, sábado.
const CASA = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const DIA = "2026-10-20";

let ana = "", bia = "", cati = "", corte = "", escova = "", paula = "", rita = "", agendado = "", perdido = "";
let n = 0;
const ap = (over: Partial<typeof appointments.$inferInsert> & { startsAt: Date }) =>
  db.insert(appointments).values({ serviceLabel: "Corte", status: "agendado", origin: "crm", externalKey: `t:${n++}`, ...over }).returning().then((r) => r[0]);

beforeEach(async () => {
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: CASA });
  [ana, bia, cati] = (await db.insert(professionals).values([
    { name: "ANA" }, { name: "Bia", active: false }, { name: "Cati", workHours: null },
  ]).returning()).map((p) => p.id);
  // "Corte" vem dos serviços de teste (test/fixture-services.ts): ganha 60 min e 15 de folga. "Escova" fica sem duração.
  corte = (await db.update(lists).set({ durationMin: 60, bufferMin: 15 }).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte"))).returning())[0].id;
  escova = (await db.insert(lists).values({ kind: "service", label: "Escova", position: 91 }).returning())[0].id;
  [paula, rita] = (await db.insert(contacts).values([{ name: "Paula Teste", phoneE164: "+5571999990001" }, { name: "Rita Teste", phoneE164: "+5571999990002" }]).returning()).map((c) => c.id);
  agendado = (await db.select().from(stages).where(eq(stages.kind, "agendado")))[0].id;
  perdido = (await db.select().from(stages).where(eq(stages.kind, "perdido")))[0].id;
});

describe("dayRulesFor: o dia de uma profissional a partir do banco", () => {
  it("horários do Avec e do CRM e lead antigo entram; cancelado, 'sem hora' do Avec, lead perdido e lead que já tem horário ficam de fora", async () => {
    await ap({ professionalId: ana, contactId: paula, serviceId: escova, serviceLabel: "Escova", startsAt: at(DIA, "09:00"), origin: "avec" }); // sem duração
    await ap({ professionalId: ana, contactId: paula, serviceId: corte, startsAt: at(DIA, "10:30") }); // 60 + 15 do serviço
    await ap({ professionalId: ana, clientName: "Lia Teste", startsAt: at(DIA, "15:00"), status: "cancelado", durationMin: 60 });
    await ap({ professionalId: ana, clientName: "Sem Hora", startsAt: at(DIA, "00:00"), origin: "avec", status: "cancelado" });
    await ap({ professionalId: ana, clientName: "Sem Hora 2", startsAt: at(DIA, "00:00"), origin: "avec", status: "agendado" });
    await db.insert(deals).values({ contactId: rita, stageId: agendado, scheduledAt: at(DIA, "14:00"), professionalId: ana, serviceId: corte });
    const [c3] = await db.insert(contacts).values([{ name: "Perdida", phoneE164: "+5571999990003" }]).returning();
    await db.insert(deals).values({ contactId: c3.id, stageId: perdido, scheduledAt: at(DIA, "16:00"), professionalId: ana, closedAt: new Date() });
    const [c4] = await db.insert(contacts).values([{ name: "Ligada", phoneE164: "+5571999990004" }]).returning();
    const [d4] = await db.insert(deals).values({ contactId: c4.id, stageId: agendado, scheduledAt: at(DIA, "17:00"), professionalId: ana }).returning();
    await ap({ professionalId: ana, contactId: c4.id, dealId: d4.id, startsAt: at(DIA, "17:00"), durationMin: 30 }); // o lead já virou horário
    await db.insert(agendaBlocks).values([
      { professionalId: null, title: "Almoço", startsOn: DIA, endsOn: DIA, startTime: "12:00", endTime: "13:00", externalKey: "b1" },
      { professionalId: ana, title: "Apagado", startsOn: DIA, endsOn: DIA, startTime: "08:00", endTime: "09:00", externalKey: "b2", deletedAt: new Date() },
      { professionalId: cati, title: "Da Cati", startsOn: DIA, endsOn: DIA, startTime: "09:00", endTime: "10:00", externalKey: "b3" },
    ]);
    const d = await dayRulesFor({ professionalId: ana, day: DIA });
    expect(d.name).toBe("Ana");
    expect(d.ranges).toEqual([[540, 1080]]);
    expect(d.blocks.map((b) => [b.title, b.start, b.end])).toEqual([["Almoço", 720, 780]]);
    expect(d.busy.map((b) => [b.label, b.start, b.end, !!b.unknownDuration])).toEqual([
      ["Paula · Escova", 540, 570, true], // sem duração: um passo
      ["Paula · Corte", 630, 705, false],
      ["Rita · Corte", 840, 915, false], // lead antigo
      ["Ligada · Corte", 1020, 1050, false],
    ]);
    const priv = await dayRulesFor({ professionalId: ana, day: DIA, privacy: true });
    expect(new Set(priv.busy.map((b) => b.label))).toEqual(new Set(["outra cliente"]));
  });

  it("a mesma cliente com outra profissional entra só para o conflito de cliente, até o fim da duração", async () => {
    await ap({ professionalId: cati, contactId: paula, serviceId: corte, startsAt: at(DIA, "10:00") });
    expect((await dayRulesFor({ professionalId: ana, day: DIA })).busy).toEqual([]);
    const d = await dayRulesFor({ professionalId: ana, day: DIA, clientId: paula });
    expect(d.busy).toEqual([expect.objectContaining({ label: "Paula · Corte", start: 600, end: 675, clientEnd: 660, otherPro: true, clientId: paula })]);
  });

  it("horário que atravessa a meia-noite é cortado em 1440 e continua no dia seguinte", async () => {
    await ap({ professionalId: ana, clientName: "Noite Teste", startsAt: at(DIA, "23:00"), durationMin: 120 });
    expect((await dayRulesFor({ professionalId: ana, day: DIA })).busy.map((b) => [b.start, b.end])).toEqual([[1380, 1440]]);
    expect((await dayRulesFor({ professionalId: ana, day: "2026-10-21" })).busy.map((b) => [b.start, b.end])).toEqual([[0, 60]]);
  });

  it("horário próprio vale até na segunda (Casa fechada); sem horário próprio, segunda não tem faixa", async () => {
    await db.update(professionals).set({ workHours: { "0": null, "1": [["10:00", "14:00"]], "2": null, "3": null, "4": null, "5": null, "6": null } }).where(eq(professionals.id, cati));
    expect((await dayRulesFor({ professionalId: cati, day: "2026-10-19" })).ranges).toEqual([[600, 840]]);
    expect((await dayRulesFor({ professionalId: cati, day: DIA })).ranges).toEqual([]);
    expect((await dayRulesFor({ professionalId: ana, day: "2026-10-19" })).ranges).toEqual([]);
  });
});

describe("checkStartFor", () => {
  const NOW = at(DIA, "08:00");
  it("conflito com quem ela já tem; encaixe só com a flag; remarcar o próprio horário não conflita com ele mesmo", async () => {
    const own = await ap({ professionalId: ana, contactId: paula, serviceId: corte, startsAt: at(DIA, "10:30") });
    expect(await checkStartFor({ professionalId: ana, startsAt: at(DIA, "10:00"), serviceId: corte, now: NOW }))
      .toEqual({ ok: false, reason: "conflito", conflicts: [{ id: own.id, label: "Paula · Corte" }] });
    expect(await checkStartFor({ professionalId: ana, startsAt: at(DIA, "10:00"), serviceId: corte, allowFitIn: true, now: NOW })).toMatchObject({ ok: true, kind: "encaixe" });
    expect(await checkStartFor({ professionalId: ana, startsAt: at(DIA, "10:00"), serviceId: corte, ignoreAppointmentId: own.id, now: NOW })).toMatchObject({ ok: true, kind: "livre" });
  });
  it("serviço sem duração não vira 60 min; dia que já passou; segunda sem horário só como fora do horário", async () => {
    expect(await checkStartFor({ professionalId: ana, startsAt: at(DIA, "10:00"), serviceId: escova, now: NOW })).toMatchObject({ ok: false, reason: "sem_duracao" });
    expect(await checkStartFor({ professionalId: ana, startsAt: at("2026-10-17", "10:00"), serviceId: corte, now: NOW })).toMatchObject({ ok: false, reason: "passou" });
    expect(await checkStartFor({ professionalId: ana, startsAt: at("2026-10-26", "10:00"), serviceId: corte, now: NOW })).toMatchObject({ ok: false, reason: "fora_do_horario" });
    expect(await checkStartFor({ professionalId: ana, startsAt: at("2026-10-26", "10:00"), serviceId: corte, allowOutsideHours: true, now: NOW })).toMatchObject({ ok: true, kind: "fora_do_horario" });
  });
});

describe("nextFreeSlots: Procurar horário", () => {
  const link = (professionalId: string, serviceId: string) => db.insert(professionalServices).values({ professionalId, serviceId });

  it("serviço sem duração e ninguém que faça: avisos, sem chutar", async () => {
    expect(await nextFreeSlots({ serviceId: escova, now: at(DIA, "08:00") })).toEqual({ ok: false, reason: "sem_duracao", service: { id: escova, label: "Escova" } });
    expect(await nextFreeSlots({ serviceId: corte, now: at(DIA, "08:00") })).toEqual({ ok: false, reason: "ninguem_faz", service: { id: corte, label: "Corte" } });
    await link(ana, corte);
    expect(await nextFreeSlots({ serviceId: corte, professionalId: cati, now: at(DIA, "08:00") }))
      .toEqual({ ok: false, reason: "ninguem_faz", service: { id: corte, label: "Corte" }, professionalName: "Cati" });
  });

  it("3 próximos de cada profissional que faz (desativada fora), sem nome de cliente nenhum", async () => {
    await link(ana, corte); await link(bia, corte); await link(cati, corte);
    await ap({ professionalId: ana, contactId: paula, serviceId: corte, startsAt: at(DIA, "10:30") });
    await ap({ professionalId: ana, contactId: rita, serviceId: escova, serviceLabel: "Escova", startsAt: at(DIA, "14:30"), origin: "avec" }); // sem duração
    await db.insert(deals).values({ contactId: rita, stageId: agendado, scheduledAt: at(DIA, "14:00"), professionalId: ana, serviceId: corte });
    await db.insert(agendaBlocks).values({ professionalId: null, title: "Almoço", startsOn: DIA, endsOn: DIA, startTime: "12:00", endTime: "13:00", externalKey: "b1" });
    const r = await nextFreeSlots({ serviceId: corte, now: at(DIA, "09:40") });
    if (!r.ok) throw new Error(r.reason);
    expect(r.service).toEqual({ id: corte, label: "Corte", durationMin: 60, bufferMin: 15 });
    const aviso = "Ana tem outra cliente às 14:30 sem duração informada: confira antes";
    expect(r.pros.map((p) => [p.name, p.slots.map((s) => [s.day, s.start, s.warnings])])).toEqual([
      ["Ana", [[DIA, 930, [aviso]], [DIA, 960, [aviso]], [DIA, 990, [aviso]]]],
      ["Cati", [[DIA, 600, []], [DIA, 630, []], [DIA, 780, []]]],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Paula|Rita/);
  });

  it("quem só trabalha na quinta: procura nos próximos dias; a busca atravessa o fim do mês", async () => {
    await link(cati, corte);
    await db.update(professionals).set({ workHours: { "0": null, "1": null, "2": null, "3": null, "4": [["09:00", "12:00"]], "5": null, "6": null } }).where(eq(professionals.id, cati));
    const r = await nextFreeSlots({ serviceId: corte, professionalId: cati, now: at(DIA, "09:40") });
    expect(r.ok && r.pros[0].slots.map((s) => [s.day, s.start])).toEqual([["2026-10-22", 540], ["2026-10-22", 570], ["2026-10-22", 600]]);
    await db.update(professionals).set({ workHours: null }).where(eq(professionals.id, cati));
    const fim = await nextFreeSlots({ serviceId: corte, professionalId: cati, now: at("2026-10-31", "17:30") }); // sábado à tarde; domingo e segunda a Casa fecha
    expect(fim.ok && fim.pros[0].slots.map((s) => [s.day, s.start])).toEqual([["2026-11-03", 540], ["2026-11-03", 570], ["2026-11-03", 600]]);
  });
});
