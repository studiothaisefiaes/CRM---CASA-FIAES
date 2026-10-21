import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { absorbCrmPlaceholders } from "./twins";

// 17/10: o "Atendimento" sem profissional que o CRM criou a partir do lead duplicava a visita do Avec (5 de 8 casos).
const NOW = bahia(17, 9);
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const absorb = () => db.transaction((tx) => absorbCrmPlaceholders(tx, { now: NOW }));
const atendimento = (contactId: string, dealId: string | null, o: Partial<typeof appointments.$inferInsert> = {}) =>
  ap({ startsAt: bahia(20, 10), contactId, dealId, origin: "crm", serviceLabel: "Atendimento", professionalId: null, serviceId: null, externalKey: `crm:${Math.random()}`, ...o });

describe("o Atendimento do lead se junta à visita do Avec do mesmo dia", () => {
  it("o do CRM sai (cancelado, com nota) e o lead passa para os horários do Avec", async () => {
    const p = await cliente("Claudia Souza", { stage: "agendado" });
    const crm = await atendimento(p.contactId, p.dealId);
    const a1 = await ap({ startsAt: bahia(20, 9), contactId: p.contactId, professionalId: s.ana.id });
    const a2 = await ap({ startsAt: bahia(20, 10), contactId: p.contactId, professionalId: s.bia.id, status: "confirmado" });
    expect(await absorb()).toEqual({ joined: 1, review: 0 });
    expect(await get(crm.id)).toMatchObject({ status: "cancelado", cancelReason: "outro", cancelledVia: "avec", cancelNote: "Junto com o horário do Avec do mesmo dia." });
    expect((await get(a1.id)).dealId).toBe(p.dealId);
    expect((await get(a2.id)).dealId).toBe(p.dealId);
    expect((await db.select().from(auditLog)).filter((l) => l.action === "avec_juntou_atendimento")).toHaveLength(1);
    expect(await absorb()).toEqual({ joined: 0, review: 0 });
  });

  it("confirmado no CRM: a confirmação passa para os do Avec que estão agendados", async () => {
    const p = await cliente("Zélia Xavier", { stage: "agendado" });
    const at = bahia(16, 12);
    await atendimento(p.contactId, p.dealId, { status: "confirmado", confirmedAt: at, confirmedVia: "link" });
    const a = await ap({ startsAt: bahia(20, 9), contactId: p.contactId, professionalId: s.ana.id });
    await absorb();
    expect(await get(a.id)).toMatchObject({ status: "confirmado", confirmedVia: "link", crmTouchedAt: null });
    expect((await get(a.id)).confirmedAt?.toISOString()).toBe(at.toISOString());
  });

  it("não junta: Avec só com cancelado ou espera no dia, outro dia, ou horário do CRM com profissional ou serviço", async () => {
    const p = await cliente("Telma Souza", { stage: "agendado" });
    const crm = await atendimento(p.contactId, p.dealId);
    await ap({ startsAt: bahia(20, 9), contactId: p.contactId, professionalId: s.ana.id, status: "cancelado" });
    await ap({ startsAt: bahia(20, 0), contactId: p.contactId, status: "espera", externalKey: "avec:esp:x" });
    await ap({ startsAt: bahia(21, 9), contactId: p.contactId, professionalId: s.ana.id });
    const q = await cliente("Rita Souza", { stage: "agendado" });
    const comPro = await atendimento(q.contactId, q.dealId, { professionalId: s.ana.id });
    const comServico = await atendimento(q.contactId, null, { serviceId: s.corte.id, serviceLabel: "Corte", startsAt: bahia(20, 16) });
    await ap({ startsAt: bahia(20, 9), contactId: q.contactId, professionalId: s.bia.id });
    expect(await absorb()).toEqual({ joined: 0, review: 0 });
    for (const id of [crm.id, comPro.id, comServico.id]) expect((await get(id)).status).toBe("agendado");
    expect((await db.select().from(appointments).orderBy(asc(appointments.startsAt))).length).toBe(7);
  });
});

describe("18/10: só junta com o horário do Avec a até 2 h do Atendimento", () => {
  it("Avec no mesmo dia, mas a mais de 2 h: o Atendimento fica, o lead não passa e vai para Conferir com o Avec", async () => {
    const p = await cliente("Lia Souza", { stage: "agendado" });
    const crm = await atendimento(p.contactId, p.dealId, { startsAt: bahia(20, 15) });
    const cedo = await ap({ startsAt: bahia(20, 9), contactId: p.contactId, professionalId: s.ana.id });
    expect(await absorb()).toEqual({ joined: 0, review: 1 });
    expect(await get(crm.id)).toMatchObject({ status: "agendado", avecReview: "atendimento_longe" });
    expect((await get(cedo.id)).dealId).toBeNull();
    expect((await db.select().from(auditLog)).filter((l) => l.action === "avec_atendimento_conferir").map((l) => l.entityId)).toEqual([crm.id]);
    expect(await absorb()).toEqual({ joined: 0, review: 0 });
    const { listAvecDivergences } = await import("./twins");
    const conferir = await listAvecDivergences({ from: bahia(19, 0), to: bahia(21, 0) });
    expect(conferir.filter((d) => d.kind === "atendimento_longe").map((d) => d.appointmentId)).toEqual([crm.id]);
  });

  it("junta e passa o lead só para os do Avec a até 2 h (2 h em ponto vale)", async () => {
    const p = await cliente("Kelly Xavier", { stage: "agendado" });
    const crm = await atendimento(p.contactId, p.dealId);
    const perto = await ap({ startsAt: bahia(20, 9), contactId: p.contactId, professionalId: s.ana.id });
    const duasHoras = await ap({ startsAt: bahia(20, 12), contactId: p.contactId, professionalId: s.bia.id, serviceLabel: "Hidratação" });
    const longe = await ap({ startsAt: bahia(20, 12, 30), contactId: p.contactId, professionalId: s.ana.id, serviceLabel: "Mechas" });
    expect(await absorb()).toEqual({ joined: 1, review: 0 });
    expect((await get(crm.id)).status).toBe("cancelado");
    expect([(await get(perto.id)).dealId, (await get(duasHoras.id)).dealId, (await get(longe.id)).dealId]).toEqual([p.dealId, p.dealId, null]);
    const audit = (await db.select().from(auditLog)).find((l) => l.action === "avec_juntou_atendimento");
    expect((audit?.data as { avec: string[] }).avec.sort()).toEqual([perto.id, duasHoras.id].sort());
  });
});

describe("Conferir com o Avec: o Avec diz Agendado sem baixa (0248) e o CRM já deu desfecho", () => {
  it("aparece como sem_baixa_no_avec; aberto nos dois não aparece aqui (fica no Sem desfecho)", async () => {
    const p = await cliente("Nina Souza");
    const fim = await ap({ startsAt: bahia(16, 9), contactId: p.contactId, professionalId: s.ana.id, status: "compareceu", avecUnclosedAt: NOW });
    await ap({ startsAt: bahia(16, 11), contactId: p.contactId, professionalId: s.bia.id, status: "agendado", avecUnclosedAt: NOW });
    const { listAvecDivergences } = await import("./twins");
    const d = await listAvecDivergences({ from: bahia(15, 0), to: bahia(18, 0) });
    expect(d.filter((x) => x.kind === "sem_baixa_no_avec").map((x) => x.appointmentId)).toEqual([fim.id]);
  });
});

describe("na importação do Avec", () => {
  it("o lote junta o Atendimento do lead com a reserva que acabou de entrar", async () => {
    const { applyAvecFiles } = await import("../avec/apply");
    const { AVEC_H, avecSheet, reserva } = await import("../../../../test/avec-fixtures");
    const p = await cliente("Renata Xavier", { stage: "agendado" });
    const crm = await atendimento(p.contactId, p.dealId);
    await applyAvecFiles([await avecSheet("r.xlsx", [AVEC_H.reservas, reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Renata Xavier", celular: Number(p.digits), pro: "Ana" })])], { now: NOW });
    expect((await get(crm.id)).status).toBe("cancelado");
  });
});
