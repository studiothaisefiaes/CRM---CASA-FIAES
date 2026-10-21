import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, deals, professionals, stages, tasks, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setAgendaMode, setupAgenda } from "../../../../test/agenda-fixtures";
import { setAppointmentStatus, undoAppointmentStatus } from "../appointments";
import { updateProfessional } from "../professionals";
import { cancelAppointments, createVisit, ensureVisitFor, rescheduleAppointment, type CreateVisitInput } from "./visits";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: bahia(16, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], ...over,
});
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

describe("remarcar", () => {
  it("muda o mesmo registro, volta para Agendado, desfaz a confirmação e a auditoria guarda o de-para", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    const id = r.appointmentIds[0];
    await setAppointmentStatus(id, "confirmado", s.cati.id, { now: bahia(15, 9, 1) });
    expect(await rescheduleAppointment(id, { startsAt: bahia(16, 14).toISOString(), professionalId: s.bia.id }, s.recepcao, bahia(15, 9, 2))).toEqual({ day: "2026-10-16", previousDay: "2026-10-16" });
    const a = await get(id);
    expect(a).toMatchObject({ status: "agendado", confirmedAt: null, confirmedVia: null, professionalId: s.bia.id, visitId: r.visitId });
    expect(a.startsAt.toISOString()).toBe(bahia(16, 14).toISOString());
    const [l] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "agendamento_remarcado")));
    expect(l.data).toMatchObject({ de: { inicio: bahia(16, 10).toISOString(), profissional: s.ana.id, status: "confirmado" }, para: { inicio: bahia(16, 14).toISOString(), profissional: s.bia.id, status: "agendado" } });
  });

  it("para outro dia, o horário sai da visita antiga e entra na visita da cliente naquele dia", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "junto" }] }), s.recepcao, NOW);
    await rescheduleAppointment(r.appointmentIds[1], { startsAt: bahia(17, 10).toISOString() }, s.recepcao, NOW);
    const [kept, moved] = [await get(r.appointmentIds[0]), await get(r.appointmentIds[1])];
    expect(kept.visitId).toBe(r.visitId);
    expect(moved.visitId).not.toBe(r.visitId);
    expect((await db.select().from(visits).where(eq(visits.id, moved.visitId!)))[0].day).toBe("2026-10-17");
  });

  it("confere o conflito sem contar o próprio horário", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(rescheduleAppointment(r.appointmentIds[0], { startsAt: bahia(16, 10, 30).toISOString() }, s.recepcao, NOW)).resolves.toMatchObject({ day: "2026-10-16" });
  });

  it("horário do Avec cancelado 'sem hora' não pode ser remarcado", async () => {
    const a = await ap({ startsAt: bahia(16, 0), status: "cancelado", professionalId: s.ana.id });
    await expect(rescheduleAppointment(a.id, { startsAt: bahia(16, 10).toISOString() }, s.recepcao, NOW)).rejects.toThrow("Só dá para remarcar um horário agendado ou confirmado.");
  });

  it("modo consulta recusa remarcar; mudar status e cancelar continuam", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    await setAgendaMode("consulta");
    await expect(rescheduleAppointment(r.appointmentIds[0], { startsAt: bahia(16, 14).toISOString() }, s.recepcao, NOW)).rejects.toThrow("só para consulta");
    await expect(setAppointmentStatus(r.appointmentIds[0], "confirmado", s.cati.id, { now: bahia(15, 9, 1) })).resolves.toEqual({ changed: true });
    await expect(cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 9, 5))).resolves.toMatchObject({ cancelled: 1 });
  });
});

describe("cancelar sem data nova (20/10)", () => {
  it("o único horário futuro cancelado tira a conversa de Agendado e deixa 'Remarcar' esperando a cliente", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "atendimento" });
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    const [before] = await db.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.contactId, p.contactId));
    expect(before.kind).toBe("agendado"); // marcar leva para Agendado
    await cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 9, 5));
    const [after] = await db.select({ id: deals.id, kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.contactId, p.contactId));
    expect(after.kind).not.toBe("agendado");
    const open = (await db.select().from(tasks).where(eq(tasks.dealId, after.id))).filter((t) => !t.doneAt);
    expect(open.length).toBeGreaterThan(0);
  });
});

describe("cancelar", () => {
  it("com motivo: só este serviço ou a visita toda; nada é apagado", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.ana.id, mode: "depois" }] }), s.recepcao, NOW);
    expect(await cancelAppointments({ appointmentId: r.appointmentIds[0], scope: "este", reason: "casa_desmarcou", note: "Ana doente" }, s.recepcao, bahia(15, 9, 5))).toEqual({ cancelled: 1, day: "2026-10-16" });
    expect(await get(r.appointmentIds[0])).toMatchObject({ status: "cancelado", cancelReason: "casa_desmarcou", cancelNote: "Ana doente", cancelledBy: s.cati.id, cancelledVia: "recepcao" });
    expect(await cancelAppointments({ appointmentId: r.appointmentIds[1], scope: "visita", reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 9, 6))).toMatchObject({ cancelled: 1 });
    expect(await db.select().from(appointments).where(eq(appointments.visitId, r.visitId))).toHaveLength(2);
  });

  it("'Outro' exige o texto do motivo", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "outro" }, s.recepcao, NOW)).rejects.toThrow("Escreva o motivo.");
  });

  it("cancelar e Desfazer no mesmo dia: o horário volta", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    await cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 9, 5));
    expect(await undoAppointmentStatus(r.appointmentIds[0], s.recepcao, bahia(15, 9, 6))).toEqual({ from: "cancelado", to: "agendado" });
    expect(await get(r.appointmentIds[0])).toMatchObject({ status: "agendado", cancelledAt: null, cancelReason: null });
  });

  it("cancelar leva a conversa recente para Em conversa esperando a cliente (1C)", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "atendimento" });
    const r = await createVisit(book(p.contactId, { dealId: p.dealId }), s.recepcao, NOW);
    await cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, bahia(15, 9, 5));
    const [st] = await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, p.dealId!));
    expect(st.k).toBe("atendimento");
  });
});

it("ensureVisitFor junta os horários ativos da mesma cliente no dia (horários do Avec sem visita)", async () => {
  const p = await cliente();
  const a1 = await ap({ startsAt: bahia(16, 10), contactId: p.contactId });
  const a2 = await ap({ startsAt: bahia(16, 11), contactId: p.contactId });
  const a3 = await ap({ startsAt: bahia(16, 12), contactId: p.contactId, status: "cancelado" });
  const v = await ensureVisitFor(a1.id);
  const rows = await db.select().from(appointments).where(inArray(appointments.id, [a1.id, a2.id, a3.id]));
  expect(rows.find((r) => r.id === a1.id)!.visitId).toBe(v);
  expect(rows.find((r) => r.id === a2.id)!.visitId).toBe(v);
  expect(rows.find((r) => r.id === a3.id)!.visitId).toBeNull();
  expect(await ensureVisitFor(a2.id)).toBe(v);
  expect((await db.select().from(visits).where(eq(visits.id, v)))[0]).toMatchObject({ origin: "avec", day: "2026-10-16", contactId: p.contactId });
});

it("desativar profissional com horários futuros: recusa com a lista; a gestão força e fica registrado (6.4, regra 14)", async () => {
  const p = await cliente("Paula Souza");
  await createVisit(book(p.contactId), s.recepcao, NOW);
  await expect(updateProfessional(s.ana.id, { active: false }, s.gestora.id, NOW)).rejects.toThrow("Ela tem 1 horário marcado: remarque antes. Paula 16/10 10:00");
  await updateProfessional(s.ana.id, { active: false, force: true }, s.gestora.id, NOW);
  expect((await db.select().from(professionals).where(eq(professionals.id, s.ana.id)))[0].active).toBe(false);
  expect(await db.select().from(auditLog).where(eq(auditLog.action, "profissional_desativada_com_horarios"))).toHaveLength(1);
});
