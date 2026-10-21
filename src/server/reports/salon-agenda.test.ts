import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { deals } from "../db/schema";
import { stageByKind } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { appt, client, item, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { salonAttendance, salonClients, salonFunnel } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW); // setembro/2026

beforeEach(resetDb);

describe("Salão: clientes, comparecimento e funil", () => {
  it("clientes novas × recorrentes: a primeira compra decide (pelo contato ou, sem contato, pelo nome)", async () => {
    const ana = await client("Ana Teste", "+5571990000001");
    await item({ day: "2026-05-10", contactId: ana, value: 1000 });              // Ana já tinha comprado
    await item({ day: "2026-09-02", contactId: ana, value: 1000 });              // recorrente em setembro
    await item({ day: "2026-09-03", clientName: "Bia Teste", value: 1000 });     // nova (sem contato, pelo nome)
    await item({ day: "2026-09-20", clientName: " bia teste ", value: 1000 });   // a mesma Bia de novo: continua uma
    await item({ day: "2026-08-15", clientName: "Caio Teste", value: 1000 });    // nova em agosto (período anterior)
    expect(await salonClients(SET)).toEqual({ novas: 1, recorrentes: 1, previous: { novas: 1, recorrentes: 0 } });
  });

  it("comparecimento por profissional e agenda sem desfecho (horário que já passou e continua agendado ou confirmado)", async () => {
    const maiara = await pro("MAIARA");
    const ana = await client("Ana Teste", "+5571990000001");
    await appt({ day: "2026-09-02", status: "compareceu", proId: maiara });
    await appt({ day: "2026-09-02", hm: "14:00", status: "compareceu", proId: maiara });
    await appt({ day: "2026-09-03", status: "faltou", proId: maiara });
    await appt({ day: "2026-09-04", status: "cancelado" });
    await appt({ day: "2026-09-05", status: "agendado", proId: maiara, contactId: ana, service: "Escova" });
    await appt({ day: "2026-09-06", status: "espera" });   // lista de espera não é horário
    await appt({ day: "2026-10-20", status: "agendado" }); // fora do período
    const r = await salonAttendance(SET, NOW);
    expect(r.rows).toEqual([
      { key: maiara, name: "MAIARA", compareceu: 2, faltou: 1, cancelado: 0, semDesfecho: 1 },
      { key: "sem", name: "Sem profissional", compareceu: 0, faltou: 0, cancelado: 1, semDesfecho: 0 },
    ]);
    expect(r.total).toEqual({ compareceu: 2, faltou: 1, cancelado: 1, semDesfecho: 1 });
    expect(r.noOutcome.n).toBe(1);
    expect(r.noOutcome.items[0]).toMatchObject({ clientName: "Ana Teste", contactId: ana, professional: "MAIARA", service: "Escova" });
  });

  it("da conversa à compra: cada passo por conta própria; horário em 2923 (data errada do Avec) não conta", async () => {
    const a = await client("Ana Teste", "+5571990000001"), b = await client("Bia Teste", "+5571990000002"), c = await client("Caio Teste", "+5571990000003");
    const stage = await stageByKind("atendimento");
    for (const id of [a, b, c]) await db.insert(deals).values({ contactId: id, stageId: stage.id, createdAt: new Date("2026-09-02T13:00:00Z") });
    await appt({ day: "2026-09-10", status: "compareceu", contactId: a });
    await item({ day: "2026-09-10", contactId: a, value: 1000 });
    await appt({ day: "2026-09-12", status: "faltou", contactId: b });
    await appt({ day: "2923-01-01", status: "agendado", contactId: c });
    await item({ day: "2026-09-20", contactId: c, value: 1000 }); // comprou sem horário (passou na recepção)
    expect(await salonFunnel(SET, NOW)).toEqual({ conversas: 3, comHorario: 2, compareceram: 1, compraram: 2 });
  });
});
