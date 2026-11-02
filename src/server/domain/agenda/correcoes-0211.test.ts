import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, professionals } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";
import { createVisit, rescheduleAppointment, type CreateVisitInput } from "./visits";
import { transferDay } from "./transfer-day";

// Correções da Agenda (revisão de 02/11).
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

const at10 = bahia(16, 10).toISOString();
const book = (contactId: string, items: CreateVisitInput["items"]): CreateVisitInput => ({ requestKey: randomUUID(), client: { contactId }, startsAt: at10, items });
const doDia = () => db.select().from(appointments).orderBy(asc(appointments.startsAt), asc(appointments.serviceLabel));

describe("a mesma profissional em dois serviços ao mesmo tempo na visita", () => {
  it("escolhida em dois serviços 'ao mesmo tempo' que não são vizinhos: recusa", async () => {
    const p = await cliente();
    await expect(createVisit(book(p.contactId, [
      { serviceId: s.corte.id, professionalId: s.ana.id },
      { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "junto" },
      { serviceId: s.mechas.id, professionalId: s.ana.id, mode: "junto", durationMin: 30 },
    ]), s.recepcao, NOW)).rejects.toThrow("Ana não pode estar em dois serviços ao mesmo tempo nesta visita.");
    expect(await doDia()).toHaveLength(0);
  });
  it("'Qualquer uma' não escolhe quem já faz outro serviço da visita no mesmo período", async () => {
    const p = await cliente();
    await createVisit(book(p.contactId, [
      { serviceId: s.corte.id, professionalId: null, preference: "sem_preferencia" },
      { serviceId: s.hidratacao.id, professionalId: s.ana.id, mode: "junto", preference: "escolhida" },
    ]), s.recepcao, NOW);
    const rows = await doDia();
    expect(rows.find((a) => a.serviceId === s.corte.id)?.professionalId).toBe(s.bia.id);
    expect(rows.find((a) => a.serviceId === s.hidratacao.id)?.professionalId).toBe(s.ana.id);
  });
  it("'Qualquer uma' sem ninguém livre fora quem já está na visita: recusa com o motivo", async () => {
    const p = await cliente();
    await expect(createVisit(book(p.contactId, [
      { serviceId: s.corte.id, professionalId: s.ana.id },
      { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "junto" },
      { serviceId: s.mechas.id, professionalId: null, mode: "junto", durationMin: 30, preference: "sem_preferencia" },
    ]), s.recepcao, NOW)).rejects.toThrow("Ninguém que faz Mechas está livre");
  });
});

describe("Passar o dia para quem já é auxiliar do horário", () => {
  it("não deixa a nova como principal e auxiliar do mesmo horário", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id, assistantIds: [s.bia.id] }]), s.recepcao, NOW);
    const out = await transferDay({ fromProfessionalId: s.ana.id, toProfessionalId: s.bia.id, day: "2026-10-16", appointmentIds: r.appointmentIds }, s.recepcao, NOW);
    expect(out.moved).toBe(0);
    expect(out.skipped[0]?.reason).toContain("Bia");
    expect((await doDia())[0].professionalId).toBe(s.ana.id);
  });
});

describe("Remarcar para profissional inativa", () => {
  it("horário sem serviço também confere se a profissional está ativa", async () => {
    const p = await cliente();
    const a = await ap({ contactId: p.contactId, clientName: "Paula Souza", professionalId: s.ana.id, serviceId: null, serviceLabel: "Atendimento", startsAt: bahia(16, 10), origin: "crm" });
    await db.update(professionals).set({ active: false }).where(eq(professionals.id, s.bia.id));
    await expect(rescheduleAppointment(a.id, { startsAt: bahia(16, 14).toISOString(), professionalId: s.bia.id }, s.recepcao, NOW))
      .rejects.toThrow("Essa profissional não está mais disponível");
  });
});

describe("gêmeos do Avec que não parearam numa importação", () => {
  it("a próxima importação confere desde a falha guardada; sem falha, só o lote dela", async () => {
    const { pairAvecTwinsAfterImport, TWINS_PENDING_KEY } = await import("./twins");
    const { settings } = await import("../../db/schema");
    const p = await cliente();
    const r = await createVisit(book(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }]), s.recepcao, NOW);
    const antes = new Date(Date.now() - 3_600_000);
    const avec = await ap({ contactId: p.contactId, clientName: "Paula Souza", professionalId: s.ana.id, serviceId: s.corte.id, startsAt: bahia(16, 10), createdAt: antes });
    const agora = new Date();
    expect(await pairAvecTwinsAfterImport(agora)).toEqual({ paired: 0 }); // de outro lote, sem falha guardada: não mexe
    await db.insert(settings).values({ key: TWINS_PENDING_KEY, value: new Date(antes.getTime() - 60_000).toISOString() });
    expect(await pairAvecTwinsAfterImport(agora)).toEqual({ paired: 1 });
    expect((await db.select().from(appointments).where(eq(appointments.id, avec.id)))[0].avecTwinOf).toBe(r.appointmentIds[0]);
    expect(await db.select().from(settings).where(eq(settings.key, TWINS_PENDING_KEY))).toHaveLength(0);
  });
  it("falhou: guarda o início do lote para a próxima", async () => {
    const { pairAvecTwinsAfterImport, TWINS_PENDING_KEY } = await import("./twins");
    const { settings } = await import("../../db/schema");
    const lote = new Date();
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("caiu"));
    await expect(pairAvecTwinsAfterImport(lote)).rejects.toThrow("caiu");
    spy.mockRestore();
    expect((await db.select().from(settings).where(eq(settings.key, TWINS_PENDING_KEY)))[0]?.value).toBe(lote.toISOString());
  });
});
