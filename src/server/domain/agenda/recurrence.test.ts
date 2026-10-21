import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { agendaBlocks, appointments, appointmentSeries, auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setAgendaMode, setSetting, setupAgenda } from "../../../../test/agenda-fixtures";
import { agendaRange } from "@/lib/agenda";
import { CONSULTA_MSG } from "@/lib/agenda-settings";
import { saveFuncoes } from "../funcoes";
import { getAgenda } from "../../queries/agenda";
import { cancelAppointments, type CreateVisitInput } from "./visits";
import { createRecurringVisits, derivedUuid, getRepetirConfig, saveRepetirConfig } from "./recurrence";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

/** Instante de "dia de novembro de 2026, h:m em Salvador" (UTC−3). */
const nov = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, day, h + 3, m));
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: bahia(15, 10).toISOString(),
  items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }], ...over,
});
const seriesAppts = (seriesId: string) => db.select().from(appointments).where(eq(appointments.seriesId, seriesId)).orderBy(asc(appointments.startsAt));
const hora = (d: Date) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" }).format(d);

describe("repetir o horário", () => {
  it("a cada 2 semanas, 4 vezes: 4 visitas, mesma hora e profissional, com series_id", async () => {
    const p = await cliente();
    const r = await createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 2, times: 4 } }, s.recepcao, NOW);
    expect(r.skipped).toEqual([]);
    expect(r.created.map((c) => c.day)).toEqual(["2026-10-15", "2026-10-29", "2026-11-12", "2026-11-26"]);
    expect(new Set(r.created.map((c) => c.visitId)).size).toBe(4);
    const rows = await seriesAppts(r.seriesId);
    expect(rows).toHaveLength(4);
    for (const a of rows) {
      expect(a).toMatchObject({ professionalId: s.ana.id, serviceId: s.corte.id, status: "agendado", fitIn: false, contactId: p.contactId, seriesId: r.seriesId });
      expect(hora(a.startsAt)).toBe("10:00");
    }
    expect(rows.map((a) => a.visitId)).toEqual(r.created.map((c) => c.visitId));
    const [serie] = await db.select().from(appointmentSeries).where(eq(appointmentSeries.id, r.seriesId));
    expect(serie).toMatchObject({ everyWeeks: 2, times: 4, createdBy: s.cati.id });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "horario_repetido"));
    expect(audit).toMatchObject({ userId: s.cati.id, entity: "appointment_series", entityId: r.seriesId });
  });

  it("a 3ª cai num bloqueio: 3 criadas, skipped [{ day: '2026-11-12', reason: /bloque/ }], nenhuma com fitIn", async () => {
    const p = await cliente();
    await db.insert(agendaBlocks).values({ professionalId: s.ana.id, title: "Curso", startsOn: "2026-11-12", endsOn: "2026-11-12", startTime: "09:00", endTime: "18:00", externalKey: "crm:blq:curso", origin: "crm", reason: "curso" });
    const r = await createRecurringVisits({ ...book(p.contactId, { fitIn: true }), repeat: { everyWeeks: 2, times: 4 } }, s.recepcao, NOW);
    expect(r.created.map((c) => c.day)).toEqual(["2026-10-15", "2026-10-29", "2026-11-26"]);
    expect(r.skipped).toEqual([{ day: "2026-11-12", reason: expect.stringMatching(/bloque/) }]);
    const rows = await seriesAppts(r.seriesId);
    expect(rows).toHaveLength(3);
    expect(rows.every((a) => !a.fitIn)).toBe(true);
  });

  it("conflito numa repetição seguinte fica de fora com o texto do motor, mesmo pedindo encaixe; só a primeira pode encaixar", async () => {
    const p = await cliente();
    await ap({ startsAt: bahia(15, 10), professionalId: s.ana.id, clientName: "Maria Avec" });
    await ap({ startsAt: bahia(22, 10), professionalId: s.ana.id, clientName: "Joana Avec" });
    const r = await createRecurringVisits({ ...book(p.contactId, { fitIn: true }), repeat: { everyWeeks: 1, times: 3 } }, s.recepcao, NOW);
    expect(r.created.map((c) => c.day)).toEqual(["2026-10-15", "2026-10-29"]);
    expect(r.skipped).toEqual([{ day: "2026-10-22", reason: "Ana já tem Joana das 10:00 às 11:00" }]);
    const rows = await seriesAppts(r.seriesId);
    expect(rows.map((a) => a.fitIn)).toEqual([true, false]);
  });

  it("a primeira falhando derruba tudo, com o erro dela", async () => {
    const p = await cliente();
    await db.insert(agendaBlocks).values({ professionalId: s.ana.id, title: "Folga", startsOn: "2026-10-15", endsOn: "2026-10-15", startTime: "09:00", endTime: "18:00", externalKey: "crm:blq:folga", origin: "crm", reason: "folga" });
    await expect(createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 1, times: 3 } }, s.recepcao, NOW)).rejects.toThrow(/bloqueada nesse horário/);
    expect(await db.select().from(appointmentSeries)).toHaveLength(0);
    expect(await db.select().from(appointments).where(eq(appointments.contactId, p.contactId))).toHaveLength(0);
  });

  it("mandar o mesmo pedido de novo não duplica (request_key da série)", async () => {
    const p = await cliente();
    await db.insert(agendaBlocks).values({ professionalId: s.ana.id, title: "Curso", startsOn: "2026-10-22", endsOn: "2026-10-22", startTime: "09:00", endTime: "18:00", externalKey: "crm:blq:c2", origin: "crm", reason: "curso" });
    const pedido = { ...book(p.contactId), repeat: { everyWeeks: 1, times: 3 } };
    const r1 = await createRecurringVisits(pedido, s.recepcao, NOW);
    const r2 = await createRecurringVisits(pedido, s.recepcao, NOW);
    expect(r2).toEqual(r1);
    expect(await db.select().from(appointmentSeries)).toHaveLength(1);
    expect(await db.select().from(appointments).where(isNotNull(appointments.seriesId))).toHaveLength(2);
  });

  it("cancelar 'este e os próximos' na 2ª cancela 2, 3 e 4 e deixa a 1ª (com a função desligada também)", async () => {
    const p = await cliente();
    const r = await createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 2, times: 4 } }, s.recepcao, NOW);
    await saveFuncoes({ repetir: false }, s.gestora.id);
    const rows = await seriesAppts(r.seriesId);
    const out = await cancelAppointments({ appointmentId: rows[1].id, scope: "serie", reason: "cliente_desmarcou" }, s.recepcao, NOW);
    expect(out.cancelled).toBe(3);
    expect((await seriesAppts(r.seriesId)).map((a) => a.status)).toEqual(["agendado", "cancelado", "cancelado", "cancelado"]);
  });

  it("'este e os próximos' num horário sem série cancela só ele", async () => {
    const p = await cliente();
    const r = await createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 1, times: 2 } }, s.recepcao, NOW);
    const avulso = await ap({ startsAt: bahia(16, 15), professionalId: s.bia.id, clientName: "Paula", contactId: p.contactId, origin: "crm" });
    expect((await cancelAppointments({ appointmentId: avulso.id, scope: "serie", reason: "cliente_desmarcou" }, s.recepcao, NOW)).cancelled).toBe(1);
    expect((await seriesAppts(r.seriesId)).map((a) => a.status)).toEqual(["agendado", "agendado"]);
  });

  it("limites: everyWeeks 0 ou 13 e times 1 ou 27 são recusados", async () => {
    const p = await cliente();
    const tenta = (everyWeeks: number, times: number) => createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks, times } }, s.recepcao, NOW);
    await expect(tenta(0, 4)).rejects.toThrow("Escolha de 1 a 12 semanas.");
    await expect(tenta(13, 4)).rejects.toThrow("Escolha de 1 a 12 semanas.");
    await expect(tenta(1, 1)).rejects.toThrow("Escolha de 2 a 26 vezes.");
    await expect(tenta(1, 27)).rejects.toThrow("Escolha de 2 a 26 vezes.");
    await expect(tenta(1.5, 4)).rejects.toThrow("Escolha de 1 a 12 semanas.");
    expect(await db.select().from(appointmentSeries)).toHaveLength(0);
  });

  it("subir maxVezes para 30 em Configurações aceita 27 vezes; maxSemanas 4 recusa 5 semanas", async () => {
    expect(await getRepetirConfig()).toEqual({ maxSemanas: 12, maxVezes: 26 });
    await saveRepetirConfig({ maxSemanas: 4, maxVezes: 30 }, s.gestora.id);
    expect(await getRepetirConfig()).toEqual({ maxSemanas: 4, maxVezes: 30 });
    const p = await cliente();
    const r = await createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 1, times: 27 } }, s.recepcao, NOW);
    expect(r.created).toHaveLength(27);
    await expect(createRecurringVisits({ ...book(p.contactId, { startsAt: bahia(15, 15).toISOString() }), repeat: { everyWeeks: 5, times: 2 } }, s.recepcao, NOW)).rejects.toThrow("Escolha de 1 a 4 semanas.");
  });

  it("Configurações: maxSemanas de 1 a 52 e maxVezes de 2 a 104; valor estranho no banco volta ao padrão", async () => {
    await expect(saveRepetirConfig({ maxSemanas: 0, maxVezes: 26 }, s.gestora.id)).rejects.toThrow("Use de 1 a 52 semanas.");
    await expect(saveRepetirConfig({ maxSemanas: 53, maxVezes: 26 }, s.gestora.id)).rejects.toThrow("Use de 1 a 52 semanas.");
    await expect(saveRepetirConfig({ maxSemanas: 12, maxVezes: 1 }, s.gestora.id)).rejects.toThrow("Use de 2 a 104 vezes.");
    await expect(saveRepetirConfig({ maxSemanas: 12, maxVezes: 105 }, s.gestora.id)).rejects.toThrow("Use de 2 a 104 vezes.");
    await saveRepetirConfig({ maxSemanas: 52, maxVezes: 104 }, s.gestora.id);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, "repetir")))[0]).toMatchObject({ userId: s.gestora.id, action: "editou" });
    await setSetting("repetir", { maxSemanas: "x", maxVezes: 500 });
    expect(await getRepetirConfig()).toEqual({ maxSemanas: 12, maxVezes: 26 });
  });

  it("modo consulta recusa (assertCanBook)", async () => {
    await setAgendaMode("consulta");
    const p = await cliente();
    await expect(createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 1, times: 2 } }, s.recepcao, NOW)).rejects.toThrow(CONSULTA_MSG);
  });

  it("função repetir desligada: criar e salvar os limites são recusados no servidor", async () => {
    await saveFuncoes({ repetir: false }, s.gestora.id);
    const p = await cliente();
    await expect(createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 1, times: 2 } }, s.recepcao, NOW)).rejects.toThrow("Essa função está desligada");
    await expect(saveRepetirConfig({ maxSemanas: 12, maxVezes: 30 }, s.gestora.id)).rejects.toThrow("Essa função está desligada");
    expect(await db.select().from(appointments).where(eq(appointments.contactId, p.contactId))).toHaveLength(0);
  });

  it("a Agenda mostra a posição na série: 'Repete: 2 de 4'", async () => {
    const p = await cliente();
    const r = await createRecurringVisits({ ...book(p.contactId), repeat: { everyWeeks: 2, times: 4 } }, s.recepcao, NOW);
    const [i] = (await getAgenda(agendaRange({ d: "2026-10-29" }, NOW), NOW)).filter((x) => x.source === "agendamento");
    expect(i.series).toEqual({ index: 2, total: 4 });
    const avulso = await ap({ startsAt: nov(2, 10), professionalId: s.bia.id, clientName: "Outra" });
    const [o] = (await getAgenda(agendaRange({ d: "2026-11-02" }, NOW), NOW)).filter((x) => x.appointmentId === avulso.id);
    expect(o.series).toBeNull();
    expect(r.seriesId).toBeTruthy();
  });

  it("derivedUuid: o mesmo pedido dá sempre a mesma chave, cada repetição a sua, e é um uuid válido", () => {
    const key = "22222222-2222-4222-8222-222222222222";
    expect(derivedUuid(key, 1)).toBe(derivedUuid(key, 1));
    expect(derivedUuid(key, 1)).not.toBe(derivedUuid(key, 2));
    for (const k of [0, 1, 25]) expect(z.string().uuid().safeParse(derivedUuid(key, k)).success).toBe(true);
  });
});
