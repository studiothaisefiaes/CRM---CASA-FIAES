import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc } from "drizzle-orm";
import { db } from "../../db";
import { appointments } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { AVEC_H, importa, reserva } from "../../../../test/avec-fixtures";
import { listAvecDivergences } from "../agenda/twins";
import { bahiaAt } from "./normalize";
import { afterVisitDone, runAfterVisit, saveAfterVisit, getAfterVisit } from "../after-visit";
import { fazerVirada } from "../../../../test/virada";
import { contacts, deals, stages, users } from "../../db/schema";
import { eq } from "drizzle-orm";

const NOW = new Date("2026-10-17T12:00:00Z");
const rows = () => db.select().from(appointments).orderBy(asc(appointments.startsAt), asc(appointments.externalKey));

beforeEach(async () => { await resetDb(); });

describe("status do Avec que o CRM não conhece (17/10: virava agendado e recebia lembrete)", () => {
  it("entra como conferir com o texto do Avec, sobe de agendado para conferir e de conferir para compareceu", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", status: "Aguardando" }),
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste" })], { now: NOW });
    expect((await rows()).map((r) => [r.clientName, r.status, r.avecStatus])).toEqual([["Ana Teste", "conferir", "Aguardando"], ["Bia Teste", "agendado", null]]);
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", status: "Desmarcado" })], { now: NOW });
    expect((await rows())[1]).toMatchObject({ status: "conferir", avecStatus: "Desmarcado" });
    await importa("r3.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", status: "Pago" })], { now: NOW });
    expect((await rows())[0]).toMatchObject({ status: "compareceu", avecStatus: null });
  });

  it("aparece em Conferir com o Avec como situação que o CRM não conhece", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", status: "Aguardando" })], { now: NOW });
    const d = await listAvecDivergences({ from: bahiaAt("2026-10-20", "00:00"), to: bahiaAt("2026-10-21", "00:00") });
    expect(d.map((x) => [x.kind, x.clientName, x.avecStatus])).toEqual([["status_desconhecido", "Ana Teste", "Aguardando"]]);
  });
});

describe("data impossível (17/10: 2029, 2923, 4676)", () => {
  it("não vira horário: fica nas recusadas, uma vez só, e aparece em Conferir com o Avec", async () => {
    const { avecRejectedRows } = await import("../../db/schema");
    const { listAvecRejected } = await import("../agenda/twins");
    const linhas = [reserva({ dia: "10/11/4676", hora: "09:00", cliente: "Ana Teste" }), reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste" })];
    await importa("r1.xlsx", AVEC_H.reservas, linhas, { now: NOW });
    await importa("r2.xlsx", AVEC_H.reservasCadastro, [["01/10/2026", "10/11/4676", "09:00", "Ana Teste", "MAIARA", "Corte", "Agendado", "Recepção"]], { now: NOW });
    expect((await rows()).map((r) => r.clientName)).toEqual(["Bia Teste"]);
    const rej = await db.select().from(avecRejectedRows);
    expect(rej.map((r) => [r.reason, r.day, r.hm, r.clientName, r.serviceLabel, r.professionalName])).toEqual([["data_fora_do_limite", "4676-11-10", "09:00", "Ana Teste", "Corte", "MAIARA"]]);
    expect((await listAvecRejected(NOW)).map((r) => [r.day, r.clientName])).toEqual([["4676-11-10", "Ana Teste"]]);
    expect(await listAvecRejected(new Date(NOW.getTime() + 31 * 86_400_000))).toEqual([]); // não veio mais em 30 dias: some da lista
  });
});

describe("cancelamento sem hora: casa por cliente + dia + profissional (17/10: 375 cancelados às 00:00)", () => {
  const C = AVEC_H.cancelamentos;
  const { cancelamento } = { cancelamento: (o: Parameters<typeof import("../../../../test/avec-fixtures").cancelamento>[0]) => import("../../../../test/avec-fixtures").then((m) => m.cancelamento(o)) };

  it("remarcação: a antiga já cancelada pelo Reservas e a nova viva — o cancelamento não mexe em nada e não grava 00:00", async () => {
    await importa("r.xlsx", AVEC_H.reservas, [
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste", celular: 71988881001, status: "Cancelado" }),
      reserva({ dia: "20/10/2026", hora: "14:00", cliente: "Ana Teste", celular: 71988881001 }),
    ], { now: NOW });
    await importa("c.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste", celular: 71988881001 })], { now: NOW });
    expect((await rows()).map((r) => [r.startsAt.toISOString(), r.status])).toEqual([[bahiaAt("2026-10-20", "10:00").toISOString(), "cancelado"], [bahiaAt("2026-10-20", "14:00").toISOString(), "agendado"]]);
  });

  it("dois serviços com a mesma profissional: cancela só o do serviço do relatório", async () => {
    await importa("r.xlsx", AVEC_H.reservas, [
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste", servico: "Escova" }),
      reserva({ dia: "20/10/2026", hora: "11:00", cliente: "Ana Teste", servico: "Corte" }),
    ], { now: NOW });
    await importa("c.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste", servico: "Corte" })], { now: NOW });
    expect((await rows()).map((r) => [r.serviceLabel, r.status])).toEqual([["Escova", "agendado"], ["Corte", "cancelado"]]);
  });

  it("mesmo serviço com profissionais diferentes: a profissional desempata", async () => {
    await importa("r.xlsx", AVEC_H.reservas, [
      reserva({ dia: "04/12/2026", hora: "09:00", cliente: "Luci Teste", pro: "FABIANA", servico: "Manutenção" }),
      reserva({ dia: "04/12/2026", hora: "17:00", cliente: "Luci Teste", pro: "LOANA", servico: "Manutenção" }),
    ], { now: NOW });
    await importa("c.xlsx", C, [await cancelamento({ dia: "04/12/2026", cliente: "Luci Teste", pro: "LOANA", servico: "Manutenção" })], { now: NOW });
    expect((await rows()).map((r) => [r.startsAt.toISOString(), r.status])).toEqual([[bahiaAt("2026-12-04", "09:00").toISOString(), "agendado"], [bahiaAt("2026-12-04", "17:00").toISOString(), "cancelado"]]);
  });

  it("dois vivos iguais (mesma profissional e serviço): não chuta e não grava 00:00", async () => {
    await importa("r.xlsx", AVEC_H.reservas, [
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste" }), reserva({ dia: "20/10/2026", hora: "15:00", cliente: "Ana Teste" }),
    ], { now: NOW });
    await importa("c.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste" })], { now: NOW });
    expect((await rows()).map((r) => r.status)).toEqual(["agendado", "agendado"]);
  });

  it("cancelamento importado antes das reservas, e de novo: nunca um horário às 00:00", async () => {
    await importa("c.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste" })], { now: NOW });
    expect(await rows()).toEqual([]);
    await importa("r.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste" })], { now: NOW });
    await importa("c2.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste" }), await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste", servico: "Escova" })], { now: NOW });
    expect((await rows()).map((r) => [r.externalKey.includes("--:--"), r.status])).toEqual([[false, "cancelado"]]);
  });

  it("horário mexido no CRM: o status fica, o Avec só anota que cancelou (aparece para conferir)", async () => {
    await importa("r.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste" })], { now: NOW });
    await db.update(appointments).set({ status: "confirmado", crmTouchedAt: NOW });
    await importa("c.xlsx", C, [await cancelamento({ dia: "20/10/2026", cliente: "Ana Teste" })], { now: NOW });
    expect((await rows()).map((r) => [r.status, r.avecStatus])).toEqual([["confirmado", "cancelado"]]);
  });
});

describe("baixa do Avec carimba a hora da conclusão (Fase B, Depois do atendimento)", () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = (iso: string) => { const d = new Date(iso); vi.setSystemTime(d); return d; };
  const comObs = (r: ReturnType<typeof reserva>, obs: string) => { const x = [...r]; x[11] = obs; return x; };

  it("horário que vira compareceu no import (novo ou subindo de agendado) ganha finished_at = agora; o que já tinha não muda", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t1 = at("2026-10-20T15:00:00Z");
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste" }),
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", status: "Pago" })], { now: t1 });
    expect((await rows()).map((r) => [r.clientName, r.status, r.finishedAt])).toEqual([["Ana Teste", "agendado", null], ["Bia Teste", "compareceu", t1]]);
    const t2 = at("2026-10-20T18:00:00Z");
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", status: "Pago" }),
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", status: "Pago" })], { now: t2 });
    expect((await rows()).map((r) => [r.clientName, r.finishedAt])).toEqual([["Ana Teste", t2], ["Bia Teste", t1]]);
  });

  it("horário que já era compareceu e recebe outro patch dias depois não vira 'concluído agora' (nem dispara o agradecimento atrasado)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    await fazerVirada("depois", g.id, "agradecimento");
    await saveAfterVisit({ ...(await getAfterVisit()), mode: "agradecimento", linkGoogle: "https://g.page/r/casa-fiaes/review" }, g.id, { confirmouEnvio: true });
    const [c] = await db.insert(contacts).values({ name: "Bia Teste", phoneE164: "+5571988776655" }).returning();
    const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
    await db.insert(deals).values({ contactId: c.id, stageId: st.id });
    const t1 = at("2026-10-20T15:00:00Z");
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", celular: 71988776655, status: "Pago" })], { now: t1 });
    const t2 = at("2026-10-21T16:00:00Z"); // 25 h depois: a observação chega num relatório novo
    await importa("r2.xlsx", AVEC_H.reservas, [comObs(reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", celular: 71988776655, status: "Pago" }), "trouxe a foto")], { now: t2 });
    const [a] = await rows();
    expect(a).toMatchObject({ notes: "trouxe a foto", finishedAt: t1 });
    expect(a.updatedAt.getTime()).toBe(t2.getTime());
    expect(await runAfterVisit(t2)).toEqual({ enqueued: 0 });
    expect(await afterVisitDone(a.visitId!, t2)).toBe("fora_do_prazo");
  });
});
