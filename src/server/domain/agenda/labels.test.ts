import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { appointmentLabels, appointments, auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";
import { agendaRange } from "@/lib/agenda";
import { getAgenda } from "../../queries/agenda";
import { createVisit, type CreateVisitInput } from "./visits";
import { getVisitTypes, listAppointmentLabels, saveAppointmentLabel, saveVisitTypes, setAppointmentLabel, setVisitType } from "./labels";
import { saveFuncoes } from "../funcoes";

let s: Awaited<ReturnType<typeof setupAgenda>>;
let verObs: string, inativo: string;
beforeEach(async () => {
  await resetDb(); s = await setupAgenda();
  verObs = (await saveAppointmentLabel({ name: "VER OBS", color: "#9a3b3b" }, s.gestora.id)).id;
  await saveAppointmentLabel({ name: "Não Cobrar" }, s.gestora.id);
  inativo = (await saveAppointmentLabel({ name: "Antigo", active: false }, s.gestora.id)).id;
});

const at10 = bahia(16, 10).toISOString();
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: at10, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], ...over,
});
const row = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const semMarcador = () => ({ ...s.recepcao, perms: s.recepcao.perms.filter((p) => p !== "agenda.marcador") });

describe("marcadores (lista)", () => {
  it("lista só os ativos, na ordem; all traz também os desativados", async () => {
    expect((await listAppointmentLabels()).map((l) => l.name)).toEqual(["VER OBS", "Não Cobrar"]);
    expect((await listAppointmentLabels({ all: true })).map((l) => l.name)).toEqual(["VER OBS", "Não Cobrar", "Antigo"]);
  });
  it("nome repetido (sem diferenciar maiúsculas) é recusado, também ao renomear", async () => {
    await expect(saveAppointmentLabel({ name: "ver obs" }, s.gestora.id)).rejects.toThrow("Já existe o marcador VER OBS.");
    const nc = (await listAppointmentLabels()).find((l) => l.name === "Não Cobrar")!;
    await expect(saveAppointmentLabel({ id: nc.id, name: "Ver Obs" }, s.gestora.id)).rejects.toThrow("Já existe o marcador VER OBS.");
    await saveAppointmentLabel({ id: nc.id, name: "NÃO COBRAR", color: "#2f6b4f" }, s.gestora.id); // o próprio nome, só maiúsculas: pode
    expect((await db.select().from(appointmentLabels).where(eq(appointmentLabels.id, nc.id)))[0]).toMatchObject({ name: "NÃO COBRAR", color: "#2f6b4f" });
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, nc.id))).length).toBe(2);
  });
  it("cor fora da paleta e nome vazio são recusados", async () => {
    await expect(saveAppointmentLabel({ name: "X", color: "#123456" }, s.gestora.id)).rejects.toThrow();
    await expect(saveAppointmentLabel({ name: "  " }, s.gestora.id)).rejects.toThrow("Escreva o nome do marcador.");
  });
});

describe("marcar com marcador e tipo", () => {
  it("marcador e tipo vão para todos os horários da visita", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId, { labelId: verObs, visitType: "noiva",
      items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.ana.id, mode: "depois" }] }), s.recepcao, NOW);
    const rows = await db.select().from(appointments).where(eq(appointments.visitId, r.visitId)).orderBy(asc(appointments.startsAt));
    expect(rows).toHaveLength(2);
    for (const a of rows) expect(a).toMatchObject({ labelId: verObs, visitType: "noiva" });
  });
  it("sem marcador nem tipo, grava vazio", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    expect(await row(r.appointmentIds[0])).toMatchObject({ labelId: null, visitType: null });
  });
  it("marcador desativado e tipo desativado são recusados ao marcar", async () => {
    const p = await cliente();
    await expect(createVisit(book(p.contactId, { labelId: inativo }), s.recepcao, NOW)).rejects.toThrow("Esse marcador não está mais em uso.");
    await saveVisitTypes({ noiva: { active: false } }, s.gestora.id);
    await expect(createVisit(book(p.contactId, { visitType: "noiva" }), s.recepcao, NOW)).rejects.toThrow("Esse tipo não está mais em uso.");
  });
  it("sem agenda.marcador a visita com marcador ou tipo é recusada; sem eles, marca normal", async () => {
    const p = await cliente();
    await expect(createVisit(book(p.contactId, { labelId: verObs }), semMarcador(), NOW)).rejects.toThrow("Você não tem permissão para isso.");
    await expect(createVisit(book(p.contactId, { visitType: "indicacao" }), semMarcador(), NOW)).rejects.toThrow("Você não tem permissão para isso.");
    await expect(createVisit(book(p.contactId), semMarcador(), NOW)).resolves.toMatchObject({ reused: false });
  });
  it("função desligada: marcar com marcador/tipo é recusado; sem eles continua", async () => {
    const p = await cliente();
    await saveFuncoes({ marcadores: false, tipo_horario: false }, s.gestora.id);
    await expect(createVisit(book(p.contactId, { labelId: verObs }), s.recepcao, NOW)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await expect(createVisit(book(p.contactId, { visitType: "noiva" }), s.recepcao, NOW)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await expect(createVisit(book(p.contactId), s.recepcao, NOW)).resolves.toMatchObject({ reused: false });
  });
});

describe("pôr marcador e tipo num horário", () => {
  it("pôr marcador não marca crmTouchedAt (o status do Avec continua chegando) e audita", async () => {
    const p = await cliente();
    const a = await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "avec" });
    expect(a.crmTouchedAt).toBeNull();
    await setAppointmentLabel(a.id, verObs, s.recepcao, NOW);
    expect(await row(a.id)).toMatchObject({ labelId: verObs, crmTouchedAt: null });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "marcador_horario")))[0]).toMatchObject({ entityId: a.id, userId: s.cati.id, data: { de: null, para: verObs, marcador: "VER OBS" } });
    await setAppointmentLabel(a.id, null, s.recepcao, NOW); // tirar
    expect((await row(a.id)).labelId).toBeNull();
  });
  it("pôr tipo também não marca crmTouchedAt e audita; tirar com null", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await setVisitType(a.id, "indicacao", s.recepcao, NOW);
    expect(await row(a.id)).toMatchObject({ visitType: "indicacao", crmTouchedAt: null });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "tipo_horario")))[0]).toMatchObject({ data: { de: null, para: "indicacao" } });
    await setVisitType(a.id, null, s.recepcao, NOW);
    expect((await row(a.id)).visitType).toBeNull();
  });
  it("marcador desativado é recusado; tipo fora da lista é recusado", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await expect(setAppointmentLabel(a.id, inativo, s.recepcao, NOW)).rejects.toThrow("Esse marcador não está mais em uso.");
    await expect(setVisitType(a.id, "primeira_vez" as never, s.recepcao, NOW)).rejects.toThrow();
    await expect(setAppointmentLabel(a.id, randomUUID(), s.recepcao, NOW)).rejects.toThrow("Marcador não encontrado.");
  });
  it("tipo desativado é recusado ao gravar, mas o já gravado continua aparecendo na agenda", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, visitType: "noiva" });
    await saveVisitTypes({ noiva: { active: false } }, s.gestora.id);
    await expect(setVisitType(a.id, "noiva", s.recepcao, NOW)).rejects.toThrow("Esse tipo não está mais em uso.");
    const item = (await getAgenda(agendaRange({ d: "2026-10-16" }, NOW), NOW)).find((i) => i.appointmentId === a.id)!;
    expect(item).toMatchObject({ visitType: "noiva", visitTypeLabel: "Noiva" });
  });
  it("função desligada: setAppointmentLabel e setVisitType recusam; o marcador já gravado continua na agenda", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, labelId: verObs });
    await saveFuncoes({ marcadores: false, tipo_horario: false }, s.gestora.id);
    await expect(setAppointmentLabel(a.id, null, s.recepcao, NOW)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await expect(setVisitType(a.id, "noiva", s.recepcao, NOW)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await expect(saveAppointmentLabel({ name: "Outro" }, s.gestora.id)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    const item = (await getAgenda(agendaRange({ d: "2026-10-16" }, NOW), NOW)).find((i) => i.appointmentId === a.id)!;
    expect(item.label).toEqual({ id: verObs, name: "VER OBS", color: "#9a3b3b" });
  });
  it("sem agenda.marcador, setAppointmentLabel e setVisitType são recusados", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id });
    await expect(setAppointmentLabel(a.id, verObs, semMarcador(), NOW)).rejects.toThrow("Você não tem permissão para isso.");
    await expect(setVisitType(a.id, "noiva", semMarcador(), NOW)).rejects.toThrow("Você não tem permissão para isso.");
    expect(await row(a.id)).toMatchObject({ labelId: null, visitType: null });
  });
});

describe("tipos do horário (rótulo e em uso editáveis)", () => {
  it("o padrão é Indicação e Noiva, os dois em uso", async () => {
    expect(await getVisitTypes()).toEqual([{ value: "indicacao", label: "Indicação", active: true }, { value: "noiva", label: "Noiva", active: true }]);
  });
  it("rótulo renomeado aparece no AgendaItem; vazio volta ao texto sugerido; nomes iguais são recusados", async () => {
    const a = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, visitType: "indicacao" });
    const item = async () => (await getAgenda(agendaRange({ d: "2026-10-16" }, NOW), NOW)).find((i) => i.appointmentId === a.id)!;
    await saveVisitTypes({ indicacao: { label: "Indicada" } }, s.gestora.id);
    expect(await item()).toMatchObject({ visitType: "indicacao", visitTypeLabel: "Indicada" });
    await expect(saveVisitTypes({ noiva: { label: "indicada" } }, s.gestora.id)).rejects.toThrow("Os dois tipos não podem ter o mesmo nome.");
    await saveVisitTypes({ indicacao: { label: "" } }, s.gestora.id);
    expect(await item()).toMatchObject({ visitTypeLabel: "Indicação" });
  });
  it("função tipo_horario desligada: salvar os tipos é recusado", async () => {
    await saveFuncoes({ tipo_horario: false }, s.gestora.id);
    await expect(saveVisitTypes({ noiva: { label: "Casamento" } }, s.gestora.id)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
  });
});
