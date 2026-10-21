import { beforeEach, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { AVEC_H, importa, reserva } from "../../../../test/avec-fixtures";
import { bahiaAt } from "./normalize";
import { isSweepReport } from "./vanished";

// 17/10: remarcar no Avec muda a hora da reserva e não manda cancelamento; a reserva antiga ficava "agendado" para sempre (9 em 30 dias).
const NOW = new Date("2026-10-17T12:00:00Z");
const rows = () => db.select().from(appointments).orderBy(asc(appointments.startsAt));
const hm = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

beforeEach(async () => { await resetDb(); });

describe("varredura: reserva que sumiu do relatório Reservas", () => {
  it("caso Maria Sonia: 11:30 e 15:00 sumiram e veio 13:30 Pago (mesma cliente, dia e profissional) → cada antiga cancelada como remarcada quando some", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "11:30", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA" })], { now: NOW });
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "15:00", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA" })], { now: NOW });
    await importa("r3.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "13:30", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA", status: "Pago" })], { now: NOW });
    expect((await rows()).map((r) => [hm(r.startsAt), r.status, r.cancelReason, r.cancelledVia, r.cancelNote])).toEqual([
      ["11:30", "cancelado", "remarcado", "avec", "Sumiu do Avec (remarcado para 15:00)."], // o 2º relatório já trouxe 15:00 no lugar dela
      ["13:30", "compareceu", null, null, null],
      ["15:00", "cancelado", "remarcado", "avec", "Sumiu do Avec (remarcado para 13:30)."],
    ]);
    expect((await db.select().from(auditLog)).filter((a) => a.action === "avec_sumiu")).toHaveLength(2);
    expect((await importa("r3b.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "13:30", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA", status: "Pago" })], { now: NOW })).summary.agendamentos).toBe(0);
  });

  it("relatório com só uma profissional não toca o horário de outra; cliente que não está no relatório não é tocada", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [
      reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", pro: "FABIANA" }),
      reserva({ dia: "20/10/2026", hora: "17:00", cliente: "Ana Teste", pro: "LOANA" }),
      reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bia Teste", pro: "FABIANA" }),
    ], { now: NOW });
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste", pro: "FABIANA" })], { now: NOW });
    expect((await rows()).map((r) => r.status)).toEqual(["agendado", "agendado", "agendado"]);
  });

  it("'Reservas (quem cadastrou)' é filtrado pela data de cadastro: nunca varre", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste" })], { now: NOW });
    await importa("r2.xlsx", AVEC_H.reservasCadastro, [["16/10/2026", "20/10/2026", "11:00", "Ana Teste", "MAIARA", "Corte", "Agendado", "Recepção"]], { now: NOW });
    expect((await rows()).map((r) => [hm(r.startsAt), r.status])).toEqual([["09:00", "agendado"], ["11:00", "agendado"]]);
  });

  it("horário mexido no CRM: o status fica e o Avec anota que cancelou (aparece para conferir)", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste" })], { now: NOW });
    await db.update(appointments).set({ status: "confirmado", crmTouchedAt: NOW });
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste" })], { now: NOW });
    expect((await rows()).map((r) => [hm(r.startsAt), r.status, r.avecStatus])).toEqual([["09:00", "confirmado", "cancelado"], ["10:00", "agendado", null]]);
  });

  it("compareceu, faltou e gêmeo não são varridos", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "09:00", cliente: "Ana Teste", status: "Pago" }), reserva({ dia: "15/10/2026", hora: "11:00", cliente: "Ana Teste", status: "Faltou" })], { now: NOW });
    await importa("r2.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "14:00", cliente: "Ana Teste" })], { now: NOW });
    expect((await rows()).map((r) => r.status)).toEqual(["compareceu", "faltou", "agendado"]);
    expect(bahiaAt("2026-10-15", "09:00")).toBeInstanceOf(Date);
  });
});

describe("revisão final: relatório antigo depois do novo", () => {
  it("o Reservas antigo cancela a remarcada; o próximo que a traz viva desfaz (só o 'remarcado' do Avec, sem mexida do CRM)", async () => {
    const velho = [reserva({ dia: "15/10/2026", hora: "11:30", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA" })];
    const novo = [reserva({ dia: "15/10/2026", hora: "13:30", cliente: "Carla Werneck", servico: "Pedicure", pro: "MARILIA" })];
    await importa("dia14.xlsx", AVEC_H.reservas, velho, { now: NOW });
    await importa("dia15.xlsx", AVEC_H.reservas, novo, { now: NOW });
    await importa("dia14-de-novo.xlsx", AVEC_H.reservas, [...velho, reserva({ dia: "15/10/2026", hora: "09:00", cliente: "Outra Teste", pro: "MARILIA" })], { now: NOW });
    expect((await rows()).filter((r) => r.clientName === "Carla Werneck").map((r) => [hm(r.startsAt), r.status])).toEqual([["11:30", "agendado"], ["13:30", "cancelado"]]);
    await importa("dia15-de-novo.xlsx", AVEC_H.reservas, [...novo, reserva({ dia: "15/10/2026", hora: "09:30", cliente: "Outra Teste", pro: "MARILIA" })], { now: NOW });
    expect((await rows()).filter((r) => r.clientName === "Carla Werneck").map((r) => [hm(r.startsAt), r.status, r.cancelReason])).toEqual([["11:30", "cancelado", "remarcado"], ["13:30", "agendado", null]]);
  });

  it("o mesmo arquivo importado de novo (já guardado) não varre", async () => {
    const a = [reserva({ dia: "15/10/2026", hora: "11:30", cliente: "Carla Werneck", pro: "MARILIA" })];
    await importa("a.xlsx", AVEC_H.reservas, a, { now: NOW });
    await importa("b.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "13:30", cliente: "Carla Werneck", pro: "MARILIA" })], { now: NOW });
    await importa("a-de-novo.xlsx", AVEC_H.reservas, a, { now: NOW }); // mesmo conteúdo: newReport = false
    expect((await rows()).map((r) => [hm(r.startsAt), r.status])).toEqual([["11:30", "cancelado"], ["13:30", "agendado"]]);
  });
});

describe("QA r66 I-4: o relatório Reservas é reconhecido pelo nome das colunas", () => {
  it("coluna a mais ou em outra ordem continua varrendo; o 'quem cadastrou' não", () => {
    expect(isSweepReport(AVEC_H.reservas)).toBe(true);
    expect(isSweepReport([...AVEC_H.reservas, "Coluna Nova"])).toBe(true);
    expect(isSweepReport([...AVEC_H.reservas].reverse())).toBe(true);
    expect(isSweepReport(AVEC_H.reservasCadastro)).toBe(false);
  });

  it("importar com uma coluna a mais (assinatura diferente) ainda cancela a reserva que sumiu", async () => {
    await importa("r1.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "09:00", cliente: "Ana Teste" })], { now: NOW });
    await importa("r2.xlsx", [...AVEC_H.reservas, "Coluna Nova"], [[...reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Ana Teste" }), "x"]], { now: NOW });
    expect((await rows()).map((r) => [hm(r.startsAt), r.status])).toEqual([["09:00", "cancelado"], ["10:00", "agendado"]]);
  });
});
