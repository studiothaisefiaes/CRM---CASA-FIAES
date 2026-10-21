import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { deals, stages, tasks } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { setAppointmentStatus } from "../appointments";
import { cancelAppointments, createVisit } from "./visits";
import { markWaitingForClient, sweepAttempts } from "../funnel";
import { addPayment, closeComanda, openComandaForAppointment } from "../caixa/comandas";
import { DEFAULT_STAGES } from "../../db/seed-data";

/**
 * Etapa "Na Casa" (pedido do dono, 15/10): a cliente está no salão. Entra quando um horário vira Chegou ou Em atendimento
 * (Agenda, app da profissional, recepção); sai para Atendida quando o último horário da visita termina (ou a comanda fecha);
 * cancelado/faltou com ela na casa volta pelas regras do 1C. Em Na Casa não há tentativas nem aviso de parado.
 */
let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

const dealOf = async (dealId: string) =>
  (await db.select({ key: stages.key, kind: stages.kind, scheduledAt: deals.scheduledAt, attempt: deals.followupAttempt, attemptTask: deals.followupTaskId })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0];
const openTasks = async (dealId: string) =>
  (await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt))).orderBy(asc(tasks.createdAt)));

async function visita(contactId: string, items: { serviceId: string; professionalId: string }[], h = 10) {
  return createVisit({
    requestKey: randomUUID(), client: { contactId }, startsAt: bahia(15, h).toISOString(),
    items: items.map((i, k) => ({ ...i, preference: "escolhida" as const, mode: k ? "depois" as const : undefined })),
  }, s.recepcao, bahia(15, 8));
}

describe("entrar em Na Casa", () => {
  it("Chegou na Agenda leva a conversa de Agendado para Na Casa, com o horário da visita", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(15, 9, 50) });
    const d = await dealOf(p.dealId!);
    expect(d.kind).toBe("na_casa");
    expect(d.key).toBe("na_casa");
    expect(d.scheduledAt?.toISOString()).toBe(bahia(15, 10).toISOString());
  });

  it("Iniciar direto no app da profissional (sem Chegou) também leva para Na Casa, mesmo vindo de Em conversa", async () => {
    const p = await cliente("Joana Lima", { conversaHaDias: 1, stage: "atendimento" });
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(a.id, "em_atendimento", null, { via: "profissional", professionalId: s.ana.id, now: bahia(15, 10, 5) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
  });
});

describe("sair de Na Casa", () => {
  it("Finalizado leva para Atendida, com o pós-atendimento do 1C", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(15, 9, 55) });
    await setAppointmentStatus(a.id, "em_atendimento", s.cati.id, { now: bahia(15, 10) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(15, 11) });
    expect((await dealOf(p.dealId!)).kind).toBe("atendido");
    expect((await openTasks(p.dealId!)).map((t) => t.title)).toContain("Pós-atendimento de Paula: agradecer, pedir foto e avaliação");
  });

  it("visita com 2 serviços: o 1º finalizado não tira de Na Casa; sai quando o último termina", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const v = await visita(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    const [corte, hidratacao] = v.appointmentIds;
    await setAppointmentStatus(corte, "chegou", s.cati.id, { now: bahia(15, 9, 55) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    await setAppointmentStatus(corte, "compareceu", s.cati.id, { now: bahia(15, 11) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa"); // a hidratação (11h, Bia) ainda vai acontecer
    await setAppointmentStatus(hidratacao, "em_atendimento", null, { via: "profissional", professionalId: s.bia.id, now: bahia(15, 11, 2) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    await setAppointmentStatus(hidratacao, "compareceu", null, { via: "profissional", professionalId: s.bia.id, now: bahia(15, 11, 50) });
    expect((await dealOf(p.dealId!)).kind).toBe("atendido");
  });

  it("comanda fechada finaliza os horários e leva para Atendida", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const v = await visita(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }]);
    await setAppointmentStatus(v.appointmentIds[0], "em_atendimento", s.cati.id, { now: bahia(15, 10) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, bahia(15, 10, 30));
    await addPayment(c.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, bahia(15, 10, 50));
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, bahia(15, 10, 55));
    expect((await dealOf(p.dealId!)).kind).toBe("atendido");
  });

  it("cancelado com a cliente na casa volta pelas regras do 1C: Em conversa esperando a cliente, com Remarcar", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(15, 9, 55) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    await cancelAppointments({ appointmentId: a.id, reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 10, 5));
    expect((await dealOf(p.dealId!)).kind).toBe("atendimento");
    expect((await dealOf(p.dealId!)).attempt).toBe(1);
    expect((await openTasks(p.dealId!)).map((t) => t.title)).toContain("Remarcar com Paula Souza");
  });

  it("cancelado na casa com outro horário marcado: volta para Agendado com a data nova", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const hoje = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await ap({ startsAt: bahia(20, 14), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(hoje.id, "chegou", s.cati.id, { now: bahia(15, 9, 55) });
    expect((await dealOf(p.dealId!)).kind).toBe("na_casa");
    await cancelAppointments({ appointmentId: hoje.id, reason: "casa_desmarcou" }, s.recepcao, bahia(15, 10, 5));
    const d = await dealOf(p.dealId!);
    expect(d.kind).toBe("agendado");
    expect(d.scheduledAt?.toISOString()).toBe(bahia(20, 14).toISOString());
  });
});

describe("enquanto Na Casa", () => {
  it("nada de tentativas: 'aguardando cliente' sem data recusa (só lembrete) e a varredura não mexe", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(15, 9, 55) });
    await expect(markWaitingForClient(p.dealId!, {}, s.cati.id, bahia(15, 10))).rejects.toThrow("Essa cliente já tem horário");
    expect(await sweepAttempts(bahia(18, 10))).toMatchObject({ advanced: 0, lost: 0 });
    const d = await dealOf(p.dealId!);
    expect(d.kind).toBe("na_casa");
    expect(d.attempt).toBe(0);
    expect(d.attemptTask).toBeNull();
  });

  it("seed: etapa 'Na Casa' logo depois de Agendado, cor própria, sem aviso de parado", async () => {
    const all = await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
    const keys = all.map((x) => x.key);
    expect(keys.indexOf("na_casa")).toBe(keys.indexOf("agendado") + 1);
    expect(keys.indexOf("atendida")).toBe(keys.indexOf("na_casa") + 1);
    const naCasa = all.find((x) => x.key === "na_casa")!;
    expect(naCasa).toMatchObject({ name: "Na Casa", kind: "na_casa", staleDays: null });
    expect(DEFAULT_STAGES.filter((x) => x.key !== "na_casa" && x.active).map((x) => x.color)).not.toContain(naCasa.color);
  });
});

it("sem conversa nos últimos 30 dias (decisão 4), Chegou não cria cartão", async () => {
  const p = await cliente("Rita Melo", { conversaHaDias: 40 });
  const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, origin: "crm" });
  await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: NOW });
  expect(await db.select().from(deals).where(eq(deals.contactId, p.contactId))).toHaveLength(0);
});
