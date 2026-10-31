import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { aiSuggestions, appointments, lists, professionals, professionalServices, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { confirmarEMarcar, desfazerMarcacao, maisDeUmServico } from "./confirmar";

describe("maisDeUmServico (caso Izaura, 30/10)", () => {
  const labels = ["COLORAÇÃO", "CORTE", "TRATAMENTO KERASTASE", "MANICURE"];
  it("coloração, tratamento e finalização: mais de um", () => {
    expect(maisDeUmServico(["coloração com Jackson, tratamento e finalização"], "COLORAÇÃO", labels)).toBe(true);
    expect(maisDeUmServico(["Retoque de raiz e complementos"], "COLORAÇÃO", labels)).toBe(true);
    expect(maisDeUmServico(["Corte + manicure"], "CORTE", labels)).toBe(true);
    expect(maisDeUmServico(["Quero corte e manicure"], "CORTE", labels)).toBe(true);
  });
  it("só o serviço do horário: um", () => {
    expect(maisDeUmServico(["Confirmado agendamento de Corte com Gilvan", "Pode ser"], "CORTE", labels)).toBe(false);
    expect(maisDeUmServico(["Seu tratamento às 10h", "ok"], "TRATAMENTO KERASTASE", labels)).toBe(false);
  });
});

describe("confirmarEMarcar", () => {
  const T0 = new Date("2026-10-20T13:00:00Z");
  let dealId = "", proId = "", serviceId = "", id = "", actor = { id: "", perms: ["agenda.marcar"] as readonly string[] };
  const slot = () => ({ id: "hc", day: "2026-10-22", time: "10:00", professionalId: proId, professionalName: "ANA", serviceId, serviceLabel: "CORTE", durationMin: 60, origem: "combinado" as const });
  beforeEach(async () => {
    await resetDb();
    const [u] = await db.insert(users).values({ name: "Sara", email: "s@t.local", role: "atendente", passwordHash: "x" }).returning();
    actor = { id: u.id, perms: ["agenda.marcar"] };
    await db.insert(settings).values({ key: "agenda_modo", value: "dupla" }).onConflictDoUpdate({ target: settings.key, set: { value: "dupla" } });
    [{ id: serviceId }] = await db.insert(lists).values({ kind: "service", label: "CORTE", active: true }).returning();
    [{ id: proId }] = await db.insert(professionals).values({ name: "ANA" }).returning();
    await db.insert(professionalServices).values({ professionalId: proId, serviceId });
    const r = await recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71999990073", pushName: "Paula", body: "Pode ser", at: T0, now: T0 });
    if (!("dealId" in r)) throw new Error("sem conversa");
    dealId = r.dealId;
    [{ id }] = await db.insert(aiSuggestions).values({ dealId, resumo: "Aceitou", sugestao: "Confirmado agendamento de Corte com Ana", precisaHumano: false, model: "x", horario: slot() }).returning();
  });
  it("sem tempo cadastrado não marca: volta para a folha", async () => {
    const r = await confirmarEMarcar(id, dealId, actor, T0);
    expect(r).toMatchObject({ marcado: false, motivo: expect.stringContaining("sem tempo cadastrado") });
    expect(await db.select().from(appointments)).toHaveLength(0);
  });
  it("com tempo marca com o tempo dela; dois toques marcam uma vez; Desfazer cancela", async () => {
    await db.update(professionalServices).set({ durationMin: 240 });
    const r = await confirmarEMarcar(id, dealId, actor, T0);
    expect(r?.marcado).toBe(true);
    await confirmarEMarcar(id, dealId, actor, T0).catch(() => null);
    const rows = await db.select().from(appointments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ durationMin: 240, professionalId: proId, status: "agendado" });
    await desfazerMarcacao(dealId, rows.map((a) => a.id), actor, T0);
    expect((await db.select().from(appointments))[0]).toMatchObject({ status: "cancelado", cancelReason: "engano" });
  });
});
