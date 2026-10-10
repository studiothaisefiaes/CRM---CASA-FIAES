import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, automations, contacts, deals, messages, stages, users, automationRuns } from "../db/schema";
import { recordInbound, recordOutbound, moveDeal } from "../domain/deals";
import { runRules } from "./engine";
import { drainOutbox } from "../domain/outbox";
import { resetDb } from "../../../test/db";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça-feira, 10h em Salvador (expediente)
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

async function lead(phone = "71999812244", at = T0) {
  const r = await recordInbound({ channelId: null, externalId: `m-${phone}-${at.getTime()}`, phoneRaw: phone, pushName: "Mariana", body: "oi", at });
  if (!("dealId" in r)) throw new Error("sem deal");
  return r.dealId;
}
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;

describe("motor de automações", () => {
  beforeEach(async () => {
    await resetDb();
    await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" });
  });

  it("lead sem resposta: alerta ao responsável no prazo da etapa (2 min) e o mesmo alerta escala para a gestão aos 10 min", async () => {
    await lead();
    await runRules(min(1));
    expect((await db.select().from(alerts)).length).toBe(0);
    const s = await runRules(min(2));
    expect(s.alerts).toBe(1);
    let rows = await db.select().from(alerts);
    expect(rows[0].audience).toBe("responsavel");
    expect(rows[0].message).toContain("Mariana");
    expect(rows[0].severity).toBe("urgente");
    await runRules(min(10));
    rows = await db.select().from(alerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ audience: "gestao", level: 2 });
    expect(rows[0].escalatedAt).not.toBeNull();
  });

  it("prazo da etapa editado vale para o alerta", async () => {
    await db.update(stages).set({ slaMinutes: 5 }).where(eq(stages.key, "lead"));
    await lead();
    await runRules(min(3));
    expect((await db.select().from(alerts)).length).toBe(0);
    await runRules(min(5));
    expect((await db.select().from(alerts)).length).toBe(1);
  });

  it("fora do expediente nada dispara; o atraso conta só em horário de atendimento", async () => {
    const sunday = new Date("2026-10-11T13:00:00Z"); // domingo
    await lead("71999812244", sunday);
    expect((await runRules(new Date(sunday.getTime() + 60 * 60_000))).closed).toBe(true);
    // segunda 08:01: só 1 min de expediente → ainda não atrasou
    await runRules(new Date("2026-10-12T11:01:00Z"));
    expect((await db.select().from(alerts)).length).toBe(0);
    await runRules(new Date("2026-10-12T11:02:30Z"));
    expect((await db.select().from(alerts)).length).toBe(1);
  });

  it("responder resolve os alertas de espera", async () => {
    const id = await lead();
    await runRules(min(3));
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(4) });
    const [a] = await db.select().from(alerts);
    expect(a.resolvedAt).not.toBeNull();
  });

  it("idempotente: rodar várias vezes não repete o alerta", async () => {
    await lead();
    await runRules(min(3)); await runRules(min(4)); await runRules(min(5));
    expect((await db.select().from(alerts)).length).toBe(1);
  });

  it("depois de respondido, nova espera gera novo alerta", async () => {
    const id = await lead();
    await runRules(min(3));
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(4) });
    await recordInbound({ channelId: null, externalId: "m2", phoneRaw: "71999812244", body: "e aí?", at: min(10) });
    await runRules(min(14)); // Atendimento: 3 min
    expect((await db.select().from(alerts)).filter((a) => a.type === "sem_resposta_minutos").length).toBe(2);
  });

  it("cliente sumiu: vai para Follow-up 1 e depois um por dia, sem pular etapas", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(day(1)); // ainda não completou 1 dia desde a última mensagem? completou: 1 dia - 1 min → não
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(new Date(day(1).getTime() + 2 * 60_000));
    expect(await stageOf(id)).toBe("followup_1");
    await runRules(new Date(day(1).getTime() + 5 * 60_000)); // mesmo dia: não avança
    expect(await stageOf(id)).toBe("followup_1");
    await runRules(new Date(day(2).getTime() + 5 * 60_000));
    expect(await stageOf(id)).toBe("followup_2");
  });

  it("parado há mais de 1 dia gera aviso", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    await db.update(automations).set({ enabled: false }).where(eq(automations.key, "followup_diario"));
    await runRules(day(2));
    expect((await db.select().from(alerts)).some((a) => a.type === "parado_dias")).toBe(true);
  });

  it("aniversário em 7 dias", async () => {
    const id = await lead();
    const target = new Date(T0.getTime() + 7 * 86_400_000 - 3 * 3_600_000);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.update(contacts).set({ birthDay: target.getUTCDate(), birthMonth: target.getUTCMonth() + 1 }).where(eq(contacts.id, d.contactId));
    await runRules(T0);
    expect((await db.select().from(alerts)).some((a) => a.type === "aniversario_em_dias" && a.message.includes("Mariana"))).toBe(true);
  });

  it("data de cobrança e recontato (lead perdido volta para Atendimento)", async () => {
    const id = await lead();
    await moveDeal(id, "perdido", null);
    await db.update(deals).set({ chargeAt: min(30), recontactAt: min(60) }).where(eq(deals.id, id));
    await runRules(min(31));
    expect((await db.select().from(alerts)).some((a) => a.type === "data_cobranca")).toBe(true);
    await runRules(min(61));
    expect(await stageOf(id)).toBe("atendimento");
  });

  it("lembrete do agendamento: manda a mensagem com data e hora, sem contar como resposta", async () => {
    process.env.DEV_TOOLS = "true";
    const id = await lead();
    await moveDeal(id, "agendado", null);
    await db.update(deals).set({ scheduledAt: new Date(T0.getTime() + 20 * 3_600_000), awaitingReplySince: new Date(T0.getTime() - 60_000) }).where(eq(deals.id, id));
    await db.update(automations).set({ enabled: true }).where(eq(automations.key, "lembrete_agendamento"));
    const s = await runRules(T0);
    expect(s.sent).toBe(1); // enfileirada: o motor não envia, a fila (worker) é que envia
    expect((await db.select().from(messages)).filter((m) => m.direction === "out")).toHaveLength(0);
    await drainOutbox(T0);
    const out = (await db.select().from(messages)).filter((m) => m.direction === "out");
    expect(out[0].body).toMatch(/Mariana[\s\S]*quarta-feira[\s\S]*06:00/);
    expect((await db.select().from(deals).where(eq(deals.id, id)))[0].awaitingReplySince).not.toBeNull();
    await runRules(new Date(T0.getTime() + 60_000));
    expect((await db.select().from(messages)).filter((m) => m.direction === "out").length).toBe(1);
  });

  it("automação desligada não roda e configuração inválida é reportada", async () => {
    await db.update(automations).set({ enabled: false });
    await lead(); await runRules(min(10));
    expect((await db.select().from(alerts)).length).toBe(0);
    await db.insert(automations).values({ name: "quebrada", trigger: { type: "xyz" }, actions: [] });
    const s = await runRules(min(11));
    expect(s.errors[0]).toContain("quebrada");
    expect((await db.select().from(automationRuns)).length).toBe(0);
  });
});
