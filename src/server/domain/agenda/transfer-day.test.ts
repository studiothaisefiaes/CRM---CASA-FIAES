import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, appointments, auditLog, messages, professionals, professionalServices, proNotifications, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setAgendaMode, setupAgenda } from "../../../../test/agenda-fixtures";
import { AVEC_H, importa, reserva } from "../../../../test/avec-fixtures";
import { setAppointmentStatus } from "../appointments";
import { saveFuncoes } from "../funcoes";
import { createVisit, type CreateVisitInput } from "./visits";
import { createRecurringVisits } from "./recurrence";
import { previewTransferDay, transferDay } from "./transfer-day";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

const DAY = "2026-10-16";
const LATER = bahia(15, 9, 5);
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: bahia(16, 10).toISOString(),
  items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "sem_preferencia" }], ...over,
});
const marca = async (name: string, h: number, over: { m?: number; preference?: "escolhida" | "sem_preferencia"; serviceId?: string; professionalId?: string } = {}) => {
  const p = await cliente(name);
  const r = await createVisit(book(p.contactId, { startsAt: bahia(16, h, over.m ?? 0).toISOString(),
    items: [{ serviceId: over.serviceId ?? s.corte.id, professionalId: over.professionalId ?? s.ana.id, preference: over.preference ?? "sem_preferencia" }] }), s.recepcao, NOW);
  return r.appointmentIds[0];
};
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const ids = (rows: { appointmentId: string }[]) => rows.map((r) => r.appointmentId);
const input = { fromProfessionalId: "", toProfessionalId: "", day: DAY };
const anaParaBia = () => ({ ...input, fromProfessionalId: s.ana.id, toProfessionalId: s.bia.id });

describe("passar o dia de uma profissional para outra", () => {
  it("passa os horários livres da Ana para a Bia, mantendo hora e 'Confirmado'", async () => {
    // A Bia tem preço e tempo próprios no Corte (0084): o horário passa com os dela.
    await db.update(professionalServices).set({ durationMin: 90, priceCents: 15000 })
      .where(and(eq(professionalServices.professionalId, s.bia.id), eq(professionalServices.serviceId, s.corte.id)));
    const a = await marca("Paula Souza", 10);
    const b = await marca("Rita Lima", 14);
    await setAppointmentStatus(a, "confirmado", s.cati.id, { now: LATER });
    const confirmedAt = (await get(a)).confirmedAt;

    const pv = await previewTransferDay(anaParaBia(), LATER);
    expect(pv.movable).toEqual([
      { appointmentId: a, hm: "10:00", clientName: "Paula Souza", serviceLabel: "Corte" },
      { appointmentId: b, hm: "14:00", clientName: "Rita Lima", serviceLabel: "Corte" },
    ]);
    expect(pv.askedForHer).toEqual([]);
    expect(pv.blocked).toEqual([]);
    // A prévia só lê.
    expect((await get(a)).professionalId).toBe(s.ana.id);

    const r = await transferDay({ ...anaParaBia(), appointmentIds: [a, b], confirmAskedForHer: false }, s.recepcao, LATER);
    expect(r).toEqual({ moved: 2, skipped: [] });
    const moved = await get(a);
    expect(moved).toMatchObject({ professionalId: s.bia.id, status: "confirmado", anyPro: false, durationMin: 90, priceCents: 15000, fitIn: false, updatedBy: s.cati.id });
    expect(moved.confirmedAt).toEqual(confirmedAt);
    expect(moved.startsAt.toISOString()).toBe(bahia(16, 10).toISOString());
    expect(moved.crmTouchedAt).toEqual(LATER);
    expect(await get(b)).toMatchObject({ professionalId: s.bia.id, status: "agendado" });
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, a), eq(auditLog.action, "agendamento_passado")));
    expect(log).toMatchObject({ userId: s.cati.id, entity: "appointment" });
    expect(log.data).toMatchObject({ de: { profissional: s.ana.id, duracao: 60, preco: 12000 }, para: { profissional: s.bia.id, duracao: 90, preco: 15000 } });
  });

  it("'Pediu ela' fica em askedForHer e só passa com confirmAskedForHer", async () => {
    const a = await marca("Paula Souza", 10, { preference: "escolhida" });
    const pv = await previewTransferDay(anaParaBia(), LATER);
    expect(ids(pv.askedForHer)).toEqual([a]);
    expect(pv.movable).toEqual([]);

    const r1 = await transferDay({ ...anaParaBia(), appointmentIds: [a], confirmAskedForHer: false }, s.recepcao, LATER);
    expect(r1).toEqual({ moved: 0, skipped: [{ appointmentId: a, reason: "Ela pediu a Ana." }] });
    expect((await get(a)).professionalId).toBe(s.ana.id);

    const r2 = await transferDay({ ...anaParaBia(), appointmentIds: [a], confirmAskedForHer: true }, s.recepcao, LATER);
    expect(r2).toEqual({ moved: 1, skipped: [] });
    expect(await get(a)).toMatchObject({ professionalId: s.bia.id, anyPro: false });
  });

  it("Bia ocupada ou sem fazer o serviço: fica em blocked com o motivo; nada vira encaixe", async () => {
    // Bia tem cliente às 10h; não faz Mechas; tem curso das 16h às 18h. O Corte dela leva 90 min: às 12h30 bate na cliente das 13h30
    // (com o tempo da Ana, 60 min, caberia).
    await db.update(professionalServices).set({ durationMin: 90 })
      .where(and(eq(professionalServices.professionalId, s.bia.id), eq(professionalServices.serviceId, s.corte.id)));
    await db.delete(professionalServices).where(and(eq(professionalServices.professionalId, s.bia.id), eq(professionalServices.serviceId, s.mechas.id)));
    await marca("Lia Bia", 10, { professionalId: s.bia.id });
    const p = await cliente("Nina Bia");
    await createVisit(book(p.contactId, { startsAt: bahia(16, 13, 30).toISOString(), items: [{ serviceId: s.hidratacao.id, professionalId: s.bia.id, preference: "sem_preferencia" }] }), s.recepcao, NOW);
    await db.insert(agendaBlocks).values({ professionalId: s.bia.id, title: "Curso", startsOn: DAY, endsOn: DAY, startTime: "16:00", endTime: "18:00", externalKey: "crm:blq:curso", origin: "crm", reason: "curso" });

    const ocupada = await marca("Paula Souza", 10);
    const tempoDela = await marca("Rita Lima", 12, { m: 30 });
    const mechas = (await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, serviceId: s.mechas.id, serviceLabel: "Mechas", clientName: "Gal Teste", durationMin: 60 })).id;
    const bloqueio = await marca("Duda Teste", 16);
    const livre = await marca("Eva Teste", 14, { m: 30 });

    const pv = await previewTransferDay(anaParaBia(), LATER);
    expect(ids(pv.movable)).toEqual([livre]);
    expect(pv.blocked.map((x) => [x.appointmentId, x.reason])).toEqual([
      [mechas, "Bia não faz esse serviço."],
      [ocupada, "Bia já tem Lia das 10:00 às 11:30"],
      [tempoDela, "Bia já tem Nina das 13:30 às 14:15"],
      [bloqueio, expect.stringMatching(/^Bia está com a agenda bloqueada/)],
    ]);

    const antes = await Promise.all([mechas, ocupada, tempoDela, bloqueio].map(get));
    const r = await transferDay({ ...anaParaBia(), appointmentIds: [mechas, ocupada, tempoDela, bloqueio, livre], confirmAskedForHer: true }, s.recepcao, LATER);
    expect(r.moved).toBe(1);
    expect(r.skipped.map((x) => x.appointmentId)).toEqual([mechas, ocupada, tempoDela, bloqueio]);
    expect(await Promise.all([mechas, ocupada, tempoDela, bloqueio].map(get))).toEqual(antes); // intocados
    expect((await db.select().from(appointments).where(eq(appointments.professionalId, s.bia.id))).every((x) => !x.fitIn)).toBe(true);
  });

  it("um horário que passa ocupa a Bia para o próximo da lista (a prévia confere em sequência)", async () => {
    const a = await marca("Paula Souza", 10);
    // Encaixe na Ana: a Rita às 10h30, por cima da Paula.
    const p = await cliente("Rita Lima");
    const e = (await createVisit(book(p.contactId, { startsAt: bahia(16, 10, 30).toISOString(), fitIn: true }), s.recepcao, NOW)).appointmentIds[0];
    const pv = await previewTransferDay(anaParaBia(), LATER);
    expect(ids(pv.movable)).toEqual([a]);
    expect(pv.blocked.map((x) => [x.appointmentId, x.reason])).toEqual([[e, "Bia já tem Paula das 10:00 às 11:00"]]);
    const r = await transferDay({ ...anaParaBia(), appointmentIds: [a, e], confirmAskedForHer: false }, s.recepcao, LATER);
    expect(r).toEqual({ moved: 1, skipped: [{ appointmentId: e, reason: "Bia já tem Paula das 10:00 às 11:00" }] });
  });

  it("só agendado, confirmado e solicitado; nunca gêmeo do Avec; só o horário do dia, não a série inteira", async () => {
    const p = await cliente();
    const serie = await createRecurringVisits({ ...book(p.contactId, { startsAt: bahia(16, 10).toISOString() }), repeat: { everyWeeks: 1, times: 2 } }, s.recepcao, NOW);
    const [hoje, semanaQueVem] = (await db.select().from(appointments).where(eq(appointments.seriesId, serie.seriesId))).sort((x, y) => +x.startsAt - +y.startsAt);
    const cancelado = await ap({ startsAt: bahia(16, 12), professionalId: s.ana.id, status: "cancelado", clientName: "Cia Teste" });
    const gemeo = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, clientName: "Paula Souza", avecTwinOf: hoje.id });
    const pv = await previewTransferDay(anaParaBia(), LATER);
    expect(ids([...pv.movable, ...pv.askedForHer, ...pv.blocked])).toEqual([hoje.id]);
    const r = await transferDay({ ...anaParaBia(), appointmentIds: [hoje.id, cancelado.id, gemeo.id], confirmAskedForHer: true }, s.recepcao, LATER);
    expect(r.moved).toBe(1);
    expect(r.skipped.map((x) => x.appointmentId)).toEqual([cancelado.id, gemeo.id]);
    expect(await get(hoje.id)).toMatchObject({ professionalId: s.bia.id, seriesId: serie.seriesId });
    expect(await get(semanaQueVem.id)).toMatchObject({ professionalId: s.ana.id });
    expect(await get(gemeo.id)).toMatchObject({ professionalId: s.ana.id, crmTouchedAt: null });
    expect(await get(cancelado.id)).toMatchObject({ professionalId: s.ana.id, status: "cancelado" });
  });

  it("horário do Avec passado não volta para a Ana ao reimportar o 0051", async () => {
    const linhas = [reserva({ dia: "16/10/2026", hora: "10:00", cliente: "Paula Teste", celular: 71988881001, pro: "ANA", servico: "Corte" })];
    await importa("r1.xlsx", AVEC_H.reservas, linhas, { now: NOW });
    const [a] = await db.select().from(appointments).where(eq(appointments.origin, "avec"));
    expect(a.professionalId).toBe(s.ana.id);
    const r = await transferDay({ ...anaParaBia(), appointmentIds: [a.id], confirmAskedForHer: true }, s.recepcao, LATER);
    expect(r.moved).toBe(1);
    await importa("r2.xlsx", AVEC_H.reservas, linhas, { now: bahia(15, 10) });
    const all = await db.select().from(appointments).where(eq(appointments.origin, "avec"));
    expect(all.filter((x) => !x.avecTwinOf)).toHaveLength(1);
    expect(await get(a.id)).toMatchObject({ professionalId: s.bia.id, crmTouchedAt: LATER });
  });

  it("a Bia recebe o aviso no app (pro_notifications) e a Ana o de saída; nenhuma mensagem para a cliente", async () => {
    const [ua, ub] = await db.insert(users).values([
      { name: "Ana Lima", email: "ana@c.com", role: "atendente", passwordHash: "x" },
      { name: "Bia Santos", email: "bia@c.com", role: "atendente", passwordHash: "x" },
    ]).returning();
    await db.update(professionals).set({ userId: ua.id }).where(eq(professionals.id, s.ana.id));
    await db.update(professionals).set({ userId: ub.id }).where(eq(professionals.id, s.bia.id));
    const a = await marca("Paula Souza", 10);
    await db.delete(proNotifications);
    const before = (await db.select().from(messages)).length;
    await transferDay({ ...anaParaBia(), appointmentIds: [a], confirmAskedForHer: false }, s.recepcao, LATER);
    const n = (await db.select().from(proNotifications)).map((x) => [x.professionalId === s.ana.id ? "ana" : "bia", x.title, x.body]).sort();
    expect(n).toEqual([
      ["ana", "Saiu da sua agenda", "Paula saiu da sua agenda (passou para a Bia)"],
      ["bia", "Horário novo", "Paula passou para você: Corte · sex 16/10 às 10:00"],
    ]);
    expect(await db.select().from(messages)).toHaveLength(before);
  });

  it("função passar_dia desligada: prévia e passar são recusadas no servidor", async () => {
    const a = await marca("Paula Souza", 10);
    await saveFuncoes({ passar_dia: false }, s.gestora.id);
    await expect(previewTransferDay(anaParaBia(), LATER)).rejects.toThrow("Essa função está desligada");
    await expect(transferDay({ ...anaParaBia(), appointmentIds: [a], confirmAskedForHer: false }, s.recepcao, LATER)).rejects.toThrow("Essa função está desligada");
    expect((await get(a)).professionalId).toBe(s.ana.id);
  });

  it("recusa a mesma profissional, dia que já passou e o modo consulta", async () => {
    const a = await marca("Paula Souza", 10);
    await expect(previewTransferDay({ ...anaParaBia(), toProfessionalId: s.ana.id }, LATER)).rejects.toThrow("Escolha outra profissional");
    await expect(previewTransferDay({ ...anaParaBia(), day: "2026-10-14" }, LATER)).rejects.toThrow("Esse dia já passou.");
    await setAgendaMode("consulta");
    await expect(transferDay({ ...anaParaBia(), appointmentIds: [a], confirmAskedForHer: false }, s.recepcao, LATER)).rejects.toThrow("só para consulta");
  });
});
