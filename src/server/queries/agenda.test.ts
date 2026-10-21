import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, lists, professionals, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { agendaRange } from "@/lib/agenda";
import { getAgenda } from "./agenda";
import { saveFuncoes } from "../domain/funcoes";

beforeEach(async () => { await resetDb(); });

const NOW = new Date(Date.UTC(2026, 9, 14, 15, 0)); // quarta 14/10, 12h em Salvador
const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));

async function setup() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const all = await db.select().from(stages);
  const stage = (kind: string) => all.find((s) => s.kind === kind)!;
  const [escova] = await db.insert(lists).values({ kind: "service", label: "Escova", position: 99 }).returning();
  let n = 0;
  const mk = async (ownerId: string | null, scheduledAt: Date | null, over: Partial<typeof deals.$inferInsert> = {}, kind = "agendado", contact: Partial<typeof contacts.$inferInsert> = {}) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+55719999200${n}`, ...contact }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: stage(kind).id, ownerId, scheduledAt, ...over }).returning();
    return d;
  };
  return { ana, bia, gestora, mk, escova };
}

describe("Agenda", () => {
  it("lista os horários do dia em ordem, com serviço, responsável e situação", async () => {
    const { ana, mk, escova } = await setup();
    await mk(ana.id, bahia(14, 16), { serviceId: escova.id });
    await mk(ana.id, bahia(14, 9, 30), { attendance: "compareceu" }, "fechado");
    await mk(null, bahia(14, 10));
    await mk(ana.id, bahia(15, 9)); // amanhã: fora do dia
    await mk(ana.id, null, {}, "atendimento"); // sem horário
    const items = await getAgenda(agendaRange({ d: "2026-10-14" }, NOW), NOW);
    expect(items.map((i) => [i.name, i.status])).toEqual([["Cliente 2", "compareceu"], ["Cliente 3", "conferir"], ["Cliente 1", "agendado"]]);
    expect(items[2]).toMatchObject({ service: "Escova", ownerName: "Ana", stageName: expect.any(String) });
    expect(items[1].ownerName).toBeNull();
  });

  it("semana: de segunda a domingo", async () => {
    const { mk } = await setup();
    await mk(null, bahia(11, 23)); // domingo anterior
    await mk(null, bahia(12, 0, 30)); // segunda bem cedo
    await mk(null, bahia(18, 20)); // domingo da semana
    await mk(null, bahia(19, 8)); // segunda seguinte
    const items = await getAgenda(agendaRange({ d: "2026-10-14", v: "semana" }, NOW), NOW);
    expect(items.map((i) => i.name)).toEqual(["Cliente 2", "Cliente 3"]);
  });

  it("a agenda é da Casa: quem não vê as conversas de todas vê mesmo assim todos os horários (a recepção organiza o dia)", async () => {
    const { ana, bia, mk } = await setup();
    await mk(ana.id, bahia(14, 9));
    await mk(bia.id, bahia(14, 10));
    await mk(null, bahia(14, 11));
    const items = await getAgenda(agendaRange({}, NOW), NOW);
    expect(items.map((i) => [i.name, i.ownerName])).toEqual([["Cliente 1", "Ana"], ["Cliente 2", "Bia"], ["Cliente 3", null]]);
  });

  it("deixa de fora lead arquivado e contato ignorado", async () => {
    const { mk } = await setup();
    await mk(null, bahia(14, 9), { archivedAt: NOW });
    await mk(null, bahia(14, 10), {}, "agendado", { ignored: true });
    await mk(null, bahia(14, 11));
    const items = await getAgenda(agendaRange({}, NOW), NOW);
    expect(items.map((i) => i.name)).toEqual(["Cliente 3"]);
  });
});

describe("Agenda por profissional", () => {
  it("mostra quem faz e filtra por profissional", async () => {
    const { mk, escova } = await setup();
    const [carla, bia] = await db.insert(professionals).values([{ name: "Carla" }, { name: "Bia" }]).returning();
    await mk(null, bahia(14, 9), { serviceId: escova.id, professionalId: carla.id });
    await mk(null, bahia(14, 10), { professionalId: bia.id });
    await mk(null, bahia(14, 11));
    const all = await getAgenda(agendaRange({}, NOW), NOW);
    expect(all.map((i) => i.professionalName)).toEqual(["Carla", "Bia", null]);
    const soCarla = await getAgenda(agendaRange({}, NOW), NOW, { professionalId: carla.id });
    expect(soCarla.map((i) => i.name)).toEqual(["Cliente 1"]);
  });
});

describe("Agenda com os agendamentos (Avec e da Casa)", () => {
  let k = 0;
  const ap = (over: Partial<typeof appointments.$inferInsert> & { startsAt: Date }) =>
    db.insert(appointments).values({ serviceLabel: "Escova", status: "agendado", origin: "avec", externalKey: `t:${++k}`, ...over }).returning().then((r) => r[0]);

  it("junta agendamentos e leads agendados, em ordem, dizendo de onde veio cada um", async () => {
    const { mk, escova } = await setup();
    await db.update(lists).set({ durationMin: 90 }).where(eq(lists.id, escova.id));
    // Nome como veio do Avec (MAIÚSCULAS): a Agenda mostra em Título.
    const [carla] = await db.insert(professionals).values({ name: "CARLA DOS SANTOS" }).returning();
    const [ana] = await db.insert(contacts).values({ name: "Ana Souza", phoneE164: "+5571988887777" }).returning();
    await mk(null, bahia(14, 10)); // lead: Cliente 1
    await ap({ startsAt: bahia(14, 9), contactId: ana.id, serviceId: escova.id, professionalId: carla.id });
    await ap({ startsAt: bahia(14, 16), clientName: "Bruna (T. USO DE IMAGEM)", serviceLabel: "Manicure", durationMin: 45, origin: "crm" });
    const items = await getAgenda(agendaRange({ d: "2026-10-14" }, NOW), NOW);
    expect(items.map((i) => [i.name, i.source, i.status])).toEqual([
      ["Ana Souza", "agendamento", "conferir"], ["Cliente 1", "lead", "conferir"], ["Bruna (T. USO DE IMAGEM)", "agendamento", "agendado"],
    ]);
    expect(items[0]).toMatchObject({ origin: "avec", service: "Escova", professionalName: "Carla dos Santos", durationMin: 90, durationEstimated: false, contactId: ana.id, dealId: null, stageName: null });
    expect(items[0].appointmentId).toEqual(expect.any(String));
    expect(items[1]).toMatchObject({ origin: "crm", durationMin: 60, durationEstimated: true, appointmentId: null });
    expect(items[2]).toMatchObject({ origin: "crm", service: "Manicure", durationMin: 45, durationEstimated: false, contactId: null, phone: null });
    expect(new Set(items.map((i) => i.key)).size).toBe(3);
  });

  it("o horário ligado a um lead (ou da mesma cliente no mesmo minuto) aparece como horário, e o lead some (6B)", async () => {
    const { mk } = await setup();
    const d = await mk(null, bahia(14, 15));
    const outro = await mk(null, bahia(14, 17));
    await ap({ startsAt: bahia(14, 15), dealId: d.id, contactId: d.contactId });
    await ap({ startsAt: bahia(14, 17), contactId: outro.contactId });
    await ap({ startsAt: bahia(14, 18), contactId: outro.contactId });
    const items = await getAgenda(agendaRange({}, NOW), NOW);
    expect(items.map((i) => [i.name, i.source])).toEqual([["Cliente 1", "agendamento"], ["Cliente 2", "agendamento"], ["Cliente 2", "agendamento"]]);
    expect(items[0].dealId).toBe(d.id);
  });

  it("6B: gêmeo fora; Chegou e Em atendimento como estão; primeira vez; campos novos", async () => {
    await setup();
    const [c] = await db.insert(contacts).values({ name: "Nova Cliente", phoneE164: "+5571988887000" }).returning();
    const [v] = await db.insert(contacts).values({ name: "Já Veio", phoneE164: "+5571988887001" }).returning();
    const crm = await ap({ startsAt: bahia(14, 9), contactId: c.id, status: "chegou", origin: "crm", fitIn: true, anyPro: true });
    await ap({ startsAt: bahia(14, 9), contactId: c.id, avecTwinOf: crm.id });
    await ap({ startsAt: bahia(1, 10), contactId: v.id, status: "compareceu" });
    await ap({ startsAt: bahia(14, 11), contactId: v.id, status: "em_atendimento" });
    const items = await getAgenda(agendaRange({}, NOW), NOW);
    expect(items.map((i) => [i.name, i.status, i.firstVisit])).toEqual([["Nova Cliente", "chegou", true], ["Já Veio", "em_atendimento", false]]);
    expect(items[0]).toMatchObject({ dbStatus: "chegou", fitIn: true, anyPro: true, paid: false, origin: "crm", visitId: null });
  });

  it("lista de espera fica de fora; cancelado entra como Cancelado; cancelamento sem hora do Avec é 'sem hora'", async () => {
    await setup();
    await ap({ startsAt: bahia(14, 0), clientName: "Espera", status: "espera" });
    await ap({ startsAt: bahia(14, 0), clientName: "Cancelou sem hora", status: "cancelado" });
    await ap({ startsAt: bahia(14, 13), clientName: "Cancelou", status: "cancelado" });
    await ap({ startsAt: bahia(14, 14), clientName: "Veio", status: "compareceu" });
    const items = await getAgenda(agendaRange({}, NOW), NOW);
    expect(items.map((i) => [i.name, i.status, i.noTime])).toEqual([
      ["Cancelou sem hora", "cancelado", true], ["Cancelou", "cancelado", false], ["Veio", "compareceu", false],
    ]);
  });

  it("o filtro por profissional vale também para os agendamentos", async () => {
    await setup();
    const [carla, bia] = await db.insert(professionals).values([{ name: "Carla" }, { name: "Bia" }]).returning();
    await ap({ startsAt: bahia(14, 9), clientName: "Da Carla", professionalId: carla.id });
    await ap({ startsAt: bahia(14, 10), clientName: "Da Bia", professionalId: bia.id });
    const soBia = await getAgenda(agendaRange({}, NOW), NOW, { professionalId: bia.id });
    expect(soBia.map((i) => i.name)).toEqual(["Da Bia"]);
  });
});

describe("item 20: aviso e uso de imagem no horário", () => {
  it("traz os avisos fixos e o uso de imagem da cliente; função uso_imagem desligada esconde só o uso de imagem", async () => {
    const { ana, mk } = await setup();
    await mk(ana.id, bahia(14, 10), {}, "agendado", { alertNotes: "Alérgica a amônia", imageUse: "nao" });
    await mk(ana.id, bahia(14, 11));
    const dia = () => getAgenda(agendaRange({ d: "2026-10-14" }, NOW), NOW);
    expect((await dia()).map((i) => [i.alertNotes ?? null, i.imageUse ?? null])).toEqual([["Alérgica a amônia", "nao"], [null, null]]);
    await saveFuncoes({ uso_imagem: false }, ana.id);
    expect((await dia()).map((i) => [i.alertNotes ?? null, i.imageUse ?? null])).toEqual([["Alérgica a amônia", null], [null, null]]);
  });
});
