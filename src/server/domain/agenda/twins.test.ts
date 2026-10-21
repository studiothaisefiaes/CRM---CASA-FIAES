import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";
import { applyAvecFiles } from "../avec/apply";
import { buildXlsx, readXlsx } from "../avec/xlsx";
import { setAppointmentStatus } from "../appointments";
import { getAgenda } from "../../queries/agenda";
import { agendaRange } from "@/lib/agenda";
import { checkSlotTx } from "./slots";
import { createVisit, rescheduleAppointment, type CreateVisitInput } from "./visits";
import { listAvecDivergences } from "./twins";

// Planilhas SINTÉTICAS, com os cabeçalhos dos formatos reais do Avec (os mesmos de avec/apply.test.ts).
const H_RES = ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"];
const H_ESP = ["Data", "Cliente", "Telefone", "Profissional", "Serviço", "Obs", "Responsavel", "Responsavel última atualização", "Data Cadastro", "Última atualização"];
const reservas = async (rows: (string | number)[][]) => ({ fileName: "reservas.xlsx", rows: await readXlsx(await buildXlsx([H_RES, ...rows])) });
const linha = (o: { cliente: string; celular: string; hora?: string; pro?: string; servico?: string; status?: string }) =>
  ["14/10/2026 10:00", "16/10/2026", o.hora ?? "10:00", o.cliente, Number(o.celular), "", "", o.pro ?? "ANA", o.servico ?? "Corte", "Interno", o.status ?? "Agendado", "", "", "", "Recepção"];
const DIA = { from: bahia(16, 0), to: bahia(17, 0) };

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: bahia(16, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], ...over,
});
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const avecRows = () => db.select().from(appointments).where(eq(appointments.origin, "avec"));

describe("Review Focus 1: o mesmo horário no CRM e no Avec (modo dupla)", () => {
  it("a reserva do Avec vira gêmea: some da grade, não ocupa, e o do CRM não muda nem com 'Cancelado' lá; a diferença vai para Conferir", async () => {
    const p = await cliente("Paula Souza");
    const crmId = (await createVisit(book(p.contactId), s.recepcao, NOW)).appointmentIds[0];
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits })])]);
    const [twin] = await avecRows();
    expect(twin.avecTwinOf).toBe(crmId);
    expect((await getAgenda(agendaRange({ d: "2026-10-16" }, NOW), NOW)).filter((i) => i.name === "Paula Souza")).toHaveLength(1);
    const q = await cliente("Joana Lima");
    const check = await checkSlotTx(db, { professionalId: s.ana.id, startsAt: bahia(16, 10), durationMin: 60, bufferMin: null, clientId: q.contactId, now: NOW });
    expect(check.ok && check.conflicts.map((c) => c.id)).toEqual([crmId]);
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits, status: "Cancelado" })])]);
    expect((await get(crmId)).status).toBe("agendado");
    expect((await get(twin.id)).status).toBe("cancelado");
    expect((await listAvecDivergences(DIA)).map((d) => [d.kind, d.appointmentId, d.avecAppointmentId])).toEqual([["status_diferente", crmId, twin.id]]);
  });

  it("reimportar o mesmo relatório não muda nada", async () => {
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    const file = await reservas([linha({ cliente: "Paula Souza", celular: p.digits })]);
    await applyAvecFiles([file]);
    const before = await db.select().from(appointments).orderBy(asc(appointments.id));
    await applyAvecFiles([file]);
    expect(await db.select().from(appointments).orderBy(asc(appointments.id))).toEqual(before);
  });

  it("serviços diferentes no mesmo horário (mão e pé) não são gêmeos", async () => {
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits, servico: "Hidratação", pro: "BIA" })])]);
    expect((await avecRows())[0].avecTwinOf).toBeNull();
  });

  it("remarcado só de um lado: horário diferente para a mesma cliente no mesmo dia vai para Conferir com o Avec", async () => {
    const p = await cliente("Paula Souza");
    const id = (await createVisit(book(p.contactId), s.recepcao, NOW)).appointmentIds[0];
    await rescheduleAppointment(id, { startsAt: bahia(16, 14).toISOString() }, s.recepcao, NOW);
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits })])]);
    expect(await listAvecDivergences(DIA)).toEqual([expect.objectContaining({
      kind: "horario_diferente", appointmentId: id, crmStartsAt: bahia(16, 14).toISOString(), avecStartsAt: bahia(16, 10).toISOString(), clientName: "Paula Souza",
    })]);
  });
});

describe("regra 15: a importação não mexe no que foi mexido no CRM", () => {
  it("Chegou fica; o 'Cancelado' do Avec só vai para avec_status e aparece em Conferir", async () => {
    const p = await cliente("Paula Souza");
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits })])]);
    const [a] = await avecRows();
    await setAppointmentStatus(a.id, "chegou", s.cati.id, { now: bahia(16, 9, 50) });
    await applyAvecFiles([await reservas([linha({ cliente: "Paula Souza", celular: p.digits, status: "Cancelado" })])]);
    expect(await get(a.id)).toMatchObject({ status: "chegou", avecStatus: "cancelado" });
    expect((await listAvecDivergences(DIA)).map((x) => x.kind)).toEqual(["status_diferente"]);
  });

  it("o 0248 (Agendamentos por status › Agendado, que parecia lista de espera) nunca cria espera, nem reimportado (gap Avec, A1)", async () => {
    const p = await cliente("Paula Souza");
    const file = { fileName: "agendados.xlsx", rows: await readXlsx(await buildXlsx([H_ESP, ["16/10/2026", "Paula Souza", Number(p.digits), "ANA", "Corte", "", "Recepção", "Recepção", "01/10/2026", "01/10/2026"]])) };
    await applyAvecFiles([file]);
    await applyAvecFiles([file]);
    expect(await db.select().from(appointments)).toHaveLength(0);
  });
});
