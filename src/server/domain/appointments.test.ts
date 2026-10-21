import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, auditLog, deals, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { setAppointmentStatus, undoAppointmentStatus, updateAppointmentNotes } from "./appointments";
import { UserFacingError } from "./errors";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const row = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const log = async (id: string) => (await db.select().from(auditLog).where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, id))).orderBy(asc(auditLog.createdAt)))
  .map((l) => [l.action, l.data]);

describe("porta única de status (spec 4.3)", () => {
  it("Chegou → Iniciar → Finalizar: carimbos, auditoria de-para e 'mexido no CRM'", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    expect(await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(16, 9, 50) })).toEqual({ changed: true });
    await setAppointmentStatus(a.id, "em_atendimento", s.cati.id, { now: bahia(16, 10, 2) });
    await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(16, 11) });
    const r = await row(a.id);
    expect(r).toMatchObject({ status: "compareceu", updatedBy: s.cati.id });
    expect([r.arrivedAt, r.startedAt, r.finishedAt].map((d) => d?.toISOString())).toEqual([bahia(16, 9, 50), bahia(16, 10, 2), bahia(16, 11)].map((d) => d.toISOString()));
    expect(r.crmTouchedAt).not.toBeNull();
    expect(await log(a.id)).toEqual([
      ["agendamento_situacao", { de: "agendado", para: "chegou", via: "recepcao" }],
      ["agendamento_situacao", { de: "chegou", para: "em_atendimento", via: "recepcao" }],
      ["agendamento_situacao", { de: "em_atendimento", para: "compareceu", via: "recepcao" }],
    ]);
  });

  it("Finalizar sem ter marcado Chegou, depois do início: grava os dois carimbos com a mesma hora", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(16, 11) });
    const r = await row(a.id);
    expect(r.arrivedAt?.toISOString()).toBe(bahia(16, 11).toISOString());
    expect(r.finishedAt?.toISOString()).toBe(bahia(16, 11).toISOString());
  });

  it("Faltou antes da hora é recusado; a profissional só 15 min depois", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await expect(setAppointmentStatus(a.id, "faltou", s.cati.id, { now: bahia(16, 9, 59) })).rejects.toThrow("Só dá para marcar falta depois do horário");
    await expect(setAppointmentStatus(a.id, "faltou", s.cati.id, { now: bahia(16, 10, 10), via: "profissional" })).rejects.toThrow("15 min depois do horário");
    expect(await setAppointmentStatus(a.id, "faltou", s.cati.id, { now: bahia(16, 10, 1) })).toEqual({ changed: true });
  });

  it("Confirmar antes do início (pela recepção); Chegou só no dia do horário", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await setAppointmentStatus(a.id, "confirmado", s.cati.id, { now: bahia(15, 9) });
    expect(await row(a.id)).toMatchObject({ status: "confirmado", confirmedVia: "recepcao" });
    await expect(setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(15, 9, 5) })).rejects.toThrow("Só dá para marcar Chegou no dia do horário.");
  });

  it("repetir o mesmo valor não muda nada nem audita", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(16, 11) });
    expect(await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(16, 11, 1) })).toEqual({ changed: false });
    expect(await log(a.id)).toHaveLength(1);
  });

  it("recusa lista de espera, horário que não existe, gêmeo do Avec e cancelar por aqui (cancelar exige motivo)", async () => {
    const espera = await ap({ startsAt: bahia(16, 0), status: "espera" });
    await expect(setAppointmentStatus(espera.id, "chegou", s.cati.id, { now: bahia(16, 9) })).rejects.toThrow(UserFacingError);
    await expect(setAppointmentStatus("00000000-0000-4000-8000-000000000000", "faltou", s.cati.id)).rejects.toThrow("Horário não encontrado.");
    const crm = await ap({ startsAt: bahia(16, 10), origin: "crm" });
    const gemeo = await ap({ startsAt: bahia(16, 10), avecTwinOf: crm.id });
    await expect(setAppointmentStatus(gemeo.id, "chegou", s.cati.id, { now: bahia(16, 9) })).rejects.toThrow("Horário não encontrado.");
    await expect(setAppointmentStatus(crm.id, "cancelado" as never, s.cati.id)).rejects.toThrow();
    expect((await row(crm.id)).status).toBe("agendado");
  });

  it("Finalizar leva a conversa recente para Atendida (gancho do 1C)", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "agendado" });
    await db.update(deals).set({ scheduledAt: bahia(15, 10) }).where(eq(deals.id, p.dealId!));
    const a = await ap({ startsAt: bahia(15, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "crm" });
    await setAppointmentStatus(a.id, "compareceu", s.cati.id, { now: bahia(15, 10, 30) });
    const [st] = await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, p.dealId!));
    expect(st.k).toBe("atendida");
  });
});

describe("Desfazer e observação", () => {
  it("Desfazer volta ao anterior no mesmo dia, limpa o carimbo e fica registrado; não desfaz duas vezes nem no dia seguinte", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(16, 9, 50) });
    await expect(undoAppointmentStatus(a.id, s.recepcao, bahia(17, 9))).rejects.toThrow("Só dá para desfazer no mesmo dia da mudança.");
    expect(await undoAppointmentStatus(a.id, s.recepcao, bahia(16, 9, 55))).toEqual({ from: "chegou", to: "agendado" });
    expect(await row(a.id)).toMatchObject({ status: "agendado", arrivedAt: null });
    await expect(undoAppointmentStatus(a.id, s.recepcao, bahia(16, 9, 56))).rejects.toThrow("Não há o que desfazer neste horário.");
    expect((await log(a.id)).at(-1)).toEqual(["agendamento_desfeito", { de: "chegou", para: "agendado" }]);
  });

  it("Desfazer um Cancelado confere de novo o horário: ocupado por outra cliente, só volta com encaixe", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, origin: "crm", status: "cancelado", cancelledAt: bahia(16, 8), cancelReason: "cliente_desmarcou" });
    await db.insert(auditLog).values({ userId: s.cati.id, action: "agendamento_situacao", entity: "appointment", entityId: a.id, data: { de: "agendado", para: "cancelado" }, createdAt: bahia(16, 8) });
    const q = await cliente("Joana Lima");
    await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, origin: "crm", contactId: q.contactId, clientName: "Joana Lima" });
    await expect(undoAppointmentStatus(a.id, s.semEncaixe, bahia(16, 8, 30))).rejects.toThrow("Ana já tem Joana das 10:00 às 11:00");
    expect(await undoAppointmentStatus(a.id, s.recepcao, bahia(16, 8, 31))).toEqual({ from: "cancelado", to: "agendado" });
    expect(await row(a.id)).toMatchObject({ status: "agendado", fitIn: true, cancelledAt: null, cancelReason: null });
  });

  it("observação: grava, audita de-para e marca como mexido no CRM; até 1000 caracteres", async () => {
    const a = await ap({ startsAt: bahia(16, 10) });
    expect(await updateAppointmentNotes(a.id, "  trazer foto da cor  ", s.cati.id, bahia(15, 9))).toEqual({ changed: true });
    expect(await row(a.id)).toMatchObject({ notes: "trazer foto da cor", updatedBy: s.cati.id });
    expect((await row(a.id)).crmTouchedAt).not.toBeNull();
    expect(await updateAppointmentNotes(a.id, "trazer foto da cor", s.cati.id, bahia(15, 9, 1))).toEqual({ changed: false });
    await expect(updateAppointmentNotes(a.id, "x".repeat(1001), s.cati.id)).rejects.toThrow("Use até 1000 caracteres na observação.");
  });
});

describe("Chegou abre a visita inteira (17/10: 'só abre um atendimento')", () => {
  it("marca Chegou em todos os horários ativos da mesma cliente no dia; não mexe em outro dia, outra cliente nem cancelado", async () => {
    const paula = await cliente("Paula Souza");
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: paula.contactId });
    const b = await ap({ startsAt: bahia(16, 10), professionalId: s.bia.id, contactId: paula.contactId, serviceLabel: "Hidratação", status: "confirmado" });
    const c = await ap({ startsAt: bahia(16, 14), professionalId: s.ana.id, contactId: paula.contactId, serviceLabel: "Escova" });
    const cancelado = await ap({ startsAt: bahia(16, 15), professionalId: s.bia.id, contactId: paula.contactId, status: "cancelado" });
    const amanha = await ap({ startsAt: bahia(17, 10), professionalId: s.ana.id, contactId: paula.contactId });
    const outra = await ap({ startsAt: bahia(16, 11), professionalId: s.bia.id, contactId: (await cliente("Rita Lima")).contactId });
    expect(await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(16, 9, 50) })).toEqual({ changed: true, alsoArrived: 2 });
    expect((await Promise.all([a, b, c, cancelado, amanha, outra].map((x) => row(x.id)))).map((r) => r.status))
      .toEqual(["chegou", "chegou", "chegou", "cancelado", "agendado", "agendado"]);
    expect((await row(c.id)).arrivedAt?.toISOString()).toBe(bahia(16, 9, 50).toISOString());
    expect(await log(b.id)).toEqual([["agendamento_situacao", { de: "confirmado", para: "chegou", via: "recepcao" }]]);
  });

  it("Hoje v3: o 'sem hora' do Avec (00:00) não vira Chegou junto com a visita", async () => {
    const paula = await cliente("Paula Souza");
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: paula.contactId });
    const meiaNoite = await ap({ startsAt: bahia(16, 0), contactId: paula.contactId, serviceLabel: "Escova" });
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(16, 9, 50) });
    expect((await row(meiaNoite.id)).status).toBe("agendado");
  });

  it("a profissional (app dela) marca só o horário dela", async () => {
    const paula = await cliente("Paula Souza");
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: paula.contactId });
    const b = await ap({ startsAt: bahia(16, 10), professionalId: s.bia.id, contactId: paula.contactId });
    await setAppointmentStatus(a.id, "chegou", null, { now: bahia(16, 9, 50), via: "profissional", professionalId: s.ana.id });
    expect((await row(b.id)).status).toBe("agendado");
  });
});

