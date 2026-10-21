import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { alerts, automations, contacts, dealEvents, deals, libraryFiles, messages, outbox, settings, stages, users, automationRuns } from "../db/schema";
import { saveAutomation } from "../domain/config";
import { saveFuncao } from "../domain/funcoes";
import { sendsMessages } from "./templates";
import { automationInputSchema, type Action, type AutomationInput } from "./types";
import { getQueue } from "../queries/queue";
import { permsFor } from "../../../test/perms";
import { recordInbound, recordOutbound, moveDeal } from "../domain/deals";
import { runRules } from "./engine";
import { drainOutbox } from "../domain/outbox";
import { resetDb } from "../../../test/db";
import { scheduleAutomation } from "../../../test/schedule-automations";

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

  it("lead sem resposta: alerta ao responsável no prazo da etapa (2 min) e o mesmo alerta escala para a gestão aos 30 min", async () => {
    await lead();
    await runRules(min(1));
    expect((await db.select().from(alerts)).length).toBe(0);
    const s = await runRules(min(2));
    expect(s.alerts).toBe(1);
    let rows = await db.select().from(alerts);
    expect(rows[0].audience).toBe("responsavel");
    expect(rows[0].message).toContain("Mariana");
    expect(rows[0].severity).toBe("urgente");
    await runRules(min(30));
    rows = await db.select().from(alerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ audience: "gestao", level: 2 });
    expect(rows[0].escalatedAt).not.toBeNull();
  });

  it("texto da espera: desde quando, prazo e dona; o escalado diz o mesmo, sem número congelado", async () => {
    await lead();
    await runRules(min(2));
    let [a] = await db.select().from(alerts);
    expect(a.message).toBe("Mariana espera resposta desde 10:00 (prazo 2 min). Dona: Ana.");
    await runRules(min(30));
    [a] = await db.select().from(alerts);
    expect(a.message).toBe("Escalado: Mariana sem resposta desde 10:00. Dona: Ana.");
  });

  it("contato marcado como 'não é cliente' (ignored) sem lead arquivado fica fora do motor", async () => {
    const id = await lead("71999812299");
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, d.contactId));
    await runRules(min(15));
    expect(await db.select().from(alerts)).toHaveLength(0);
    expect((await db.select().from(automationRuns)).filter((r) => r.dealId === id)).toHaveLength(0);
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

  it("espera que atravessa dias fechados (Casa ter–sáb 9–18h salva): sábado 17:55 → terça 9:02 está no prazo na Fila e no motor; 9:11 atrasa", async () => {
    const win: [string, string] = ["09:00", "18:00"];
    await db.insert(settings).values({ key: "business_hours", value: { 0: null, 1: null, 2: win, 3: win, 4: win, 5: win, 6: win } });
    await db.update(stages).set({ slaMinutes: 15 }).where(eq(stages.key, "lead")); // prazos do Lote 0: 15 min (escala em 30)
    await db.update(automations).set({ trigger: { type: "sem_resposta_minutos", minutes: 30 } }).where(eq(automations.key, "gestao_10min"));
    await db.update(automations).set({ enabled: false }).where(inArray(automations.key, ["followup_diario", "parado_1dia"])); // desligadas no Lote 0
    const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const comoGestao = { id: gestora.id, perms: permsFor("gestor") };
    const id = await lead("71999812244", new Date("2026-10-17T20:55:00Z")); // sábado 17:55 em Salvador
    const terca = (hm: string) => new Date(`2026-10-20T${hm}:00-03:00`); // domingo e segunda fechados
    expect((await runRules(terca("09:02"))).alerts).toBe(0); // 7 min de expediente, não "3 dias além do prazo"
    let q = await getQueue(comoGestao, { now: terca("09:02") });
    expect(q.sections.map((s) => [s.key, s.items.map((i) => i.dealId)])).toEqual([["aguardando", [id]]]);
    expect((await runRules(terca("09:11"))).alerts).toBe(1); // 16 min: passou dos 15
    q = await getQueue(comoGestao, { now: terca("09:11") });
    expect(q.sections.map((s) => s.key)).toEqual(["atrasados"]);
    expect((await db.select().from(alerts).where(eq(alerts.type, "sem_resposta_minutos")))[0].message).toBe("Mariana espera resposta desde sáb 17/10 17:55 (prazo 15 min). Dona: Ana.");
  });

  it("parado não conta os dias com a Casa fechada: Em conversa de sábado 17h não avisa na terça; avisa quarta 17:01 (2 dias de casa aberta)", async () => {
    const win: [string, string] = ["09:00", "18:00"];
    await db.insert(settings).values({ key: "business_hours", value: { 0: null, 1: null, 2: win, 3: win, 4: win, 5: win, 6: win } });
    const sab = new Date("2026-10-17T20:00:00Z"); // sábado 17:00 em Salvador
    const id = await lead("71999812244", new Date(sab.getTime() - 2 * 60_000));
    await recordOutbound({ dealId: id, channelId: null, body: "qual dia?", at: new Date(sab.getTime() - 60_000) });
    await recordInbound({ channelId: null, externalId: "x-sab", phoneRaw: "71999812244", body: "quero sexta", at: sab });
    await db.update(automations).set({ enabled: false }).where(inArray(automations.key, ["lead_2min", "atendimento_3min", "gestao_10min"]));
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(new Date("2026-10-20T12:30:00Z")); // terça 9:30: 3 dias no relógio, mas só a noite de sábado com a Casa aberta
    expect((await db.select().from(alerts)).filter((a) => a.type === "parado_dias")).toHaveLength(0);
    await runRules(new Date("2026-10-21T20:01:00Z")); // quarta 17:01
    const parados = (await db.select().from(alerts)).filter((a) => a.type === "parado_dias");
    expect(parados).toHaveLength(1);
    expect(parados[0].message).toContain("há 2 dia(s)");
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

  it("Casa falou por último há 4 h de expediente: continua em Em conversa, esperando a cliente com a tentativa 1 (nada é enviado)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    const attempt = async () => (await db.select().from(deals).where(eq(deals.id, id)))[0].followupAttempt;
    await runRules(min(1 + 4 * 60 - 2));
    expect(await attempt()).toBe(0);
    await runRules(min(1 + 4 * 60 + 1));
    expect(await stageOf(id)).toBe("atendimento");
    expect(await attempt()).toBe(1);
    expect(await db.select().from(outbox)).toHaveLength(0);
    await runRules(day(4)); // já esperando: não repete nem pula etapa
    expect(await stageOf(id)).toBe("atendimento");
    expect(await attempt()).toBe(1);
  });

  it("as 4 h contam só o expediente: resposta às 19h de terça vira 'esperando a cliente' às 11h de quarta", async () => {
    const id = await lead("71999812266", new Date("2026-10-13T21:30:00Z"));
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: new Date("2026-10-13T22:00:00Z") });
    const attempt = async () => (await db.select().from(deals).where(eq(deals.id, id)))[0].followupAttempt;
    await runRules(new Date("2026-10-14T13:59:00Z"));
    expect(await attempt()).toBe(0);
    await runRules(new Date("2026-10-14T14:01:00Z"));
    expect(await attempt()).toBe(1);
    expect(await stageOf(id)).toBe("atendimento");
  });

  it("cliente falou por último: fica em Em conversa (é a vez da Casa)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "qual dia?", at: min(1) });
    await recordInbound({ channelId: null, externalId: "x-cliente", phoneRaw: "71999812244", body: "quero sexta", at: min(2) });
    await runRules(day(2));
    expect(await stageOf(id)).toBe("atendimento");
  });

  it("'próximo follow-up' (legado) nunca leva para Follow-up 2: fica em Em conversa esperando a cliente", async () => {
    await db.update(automations).set({ enabled: true }).where(eq(automations.key, "followup_diario"));
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    await runRules(day(2));
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(day(4));
    expect(await stageOf(id)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, id)))[0].followupAttempt).toBe(1);
  });

  it("parado: um aviso só por conversa na etapa (nada de repetir todo dia)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "qual dia?", at: min(1) });
    await recordInbound({ channelId: null, externalId: "x-parado", phoneRaw: "71999812244", body: "quero sexta", at: min(2) });
    await runRules(day(3));
    await runRules(day(4));
    const parados = (await db.select().from(alerts)).filter((a) => a.type === "parado_dias");
    expect(parados).toHaveLength(1);
    expect(parados[0].message).toContain("Em conversa");
  });

  it("aniversário em 7 dias", async () => {
    const id = await lead();
    const target = new Date(T0.getTime() + 7 * 86_400_000 - 3 * 3_600_000);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.update(contacts).set({ birthDay: target.getUTCDate(), birthMonth: target.getUTCMonth() + 1 }).where(eq(contacts.id, d.contactId));
    await runRules(T0);
    expect((await db.select().from(alerts)).some((a) => a.type === "aniversario_em_dias" && a.message.includes("Mariana"))).toBe(true);
    const aniv = (await db.select().from(alerts)).find((a) => a.type === "aniversario_em_dias")!;
    expect(aniv.message).toMatch(/^Aniversário de Mariana dia \d{2}\/\d{2}\. Que tal mandar um parabéns\?$/);
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
    await scheduleAutomation("texto");
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

/* ---------- Task 7: ações novas nas regras de tempo e ao salvar ---------- */
describe("regras: ações novas (tempo e salvar)", () => {
  let gestora = "";
  const base = (actions: Action[]): AutomationInput => ({ name: "Tabela", enabled: false, trigger: { type: "sem_resposta_minutos", minutes: 2 }, conditions: [], actions });
  beforeEach(async () => {
    await resetDb();
    await db.update(automations).set({ enabled: false });
    [{ id: gestora }] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  });

  it("enviar_arquivo com 10 min de atraso entra na fila com notBefore = agora + 10 min", async () => {
    const [f] = await db.insert(libraryFiles).values({ name: "Tabela de preços.pdf", path: "biblioteca/x.pdf", mime: "application/pdf", kind: "document" }).returning();
    await db.insert(automations).values({ ...base([{ type: "enviar_arquivo", fileId: f.id, caption: "Oi, {nome}! Segue a tabela.", delayMinutes: 10 }]), enabled: true });
    await lead();
    const s = await runRules(min(2));
    expect(s.errors).toEqual([]);
    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ kind: "media", notBefore: min(12) });
    expect(row.options).toMatchObject({ fileId: f.id, caption: "Oi, Mariana! Segue a tabela." });
  });

  it("ligar regra com enviar_arquivo pede a confirmação de envio real (sendsMessages)", async () => {
    expect(sendsMessages([{ type: "enviar_arquivo" }])).toBe(true);
    const [f] = await db.insert(libraryFiles).values({ name: "Tabela.pdf", path: "biblioteca/x.pdf", mime: "application/pdf", kind: "document" }).returning();
    await expect(saveAutomation(null, { ...base([{ type: "enviar_arquivo", fileId: f.id }]), enabled: true }, gestora)).rejects.toThrow("Confirme o envio real para ligar.");
  });

  it("mudar_status resolvido numa regra de tempo arquiva a conversa como Sistema", async () => {
    await db.insert(automations).values({ ...base([{ type: "mudar_status", status: "resolvido" }]), enabled: true });
    const id = await lead();
    const s = await runRules(min(2));
    expect(s.errors).toEqual([]);
    expect((await db.select().from(deals).where(eq(deals.id, id)))[0].conversationArchivedAt).not.toBeNull();
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, id), eq(dealEvents.type, "conversa_arquivada")));
    expect(ev.userId).toBeNull();
  });

  it("arquivo apagado da Biblioteca: salvar a regra recusa ('Esse arquivo saiu da Biblioteca. Escolha outro.')", async () => {
    const [f] = await db.insert(libraryFiles).values({ name: "Tabela.pdf", path: "biblioteca/x.pdf", mime: "application/pdf", kind: "document", deletedAt: new Date() }).returning();
    await expect(saveAutomation(null, base([{ type: "enviar_arquivo", fileId: f.id }]), gestora)).rejects.toThrow("Esse arquivo saiu da Biblioteca. Escolha outro.");
  });

  it("o atraso máximo é o número da função (Atraso máximo de uma ação, padrão 240 min)", async () => {
    const msg = (delayMinutes: number): Action[] => [{ type: "enviar_mensagem", message: "Oi, {nome}!", delayMinutes }];
    await expect(saveAutomation(null, base(msg(300)), gestora)).rejects.toThrow("O atraso máximo de uma ação é 240 min (Configurações › Recursos).");
    expect(await saveAutomation(null, base(msg(240)), gestora)).toBeTruthy();
    await saveFuncao("regras_acontecimento", { params: { atraso_max_min: 600 } }, gestora);
    expect(await saveAutomation(null, base(msg(300)), gestora)).toBeTruthy();
  });

  it("formato das ações novas: até 6 ações, nota de 3 a 500 letras, atraso de 0 a 1440 min", () => {
    const ok = (actions: unknown[]) => automationInputSchema.safeParse({ ...base([]), actions }).success;
    const nota = { type: "escrever_nota", text: "Pediu para remarcar" };
    expect(ok(Array(6).fill(nota))).toBe(true);
    expect(ok(Array(7).fill(nota))).toBe(false);
    expect(ok([{ type: "escrever_nota", text: "ok" }])).toBe(false);
    expect(ok([{ type: "escrever_nota", text: "x".repeat(501) }])).toBe(false);
    expect(ok([{ type: "enviar_mensagem", message: "Oi, {nome}!", delayMinutes: 1441 }])).toBe(false);
    expect(ok([{ type: "passar_para", to: { team: "6f1c2a3e-8b4d-4e5f-9a6b-7c8d9e0f1a2b" } }, { type: "mudar_status", status: "resolvido" }, { type: "por_etiqueta", tag: "VIP" }, { type: "tirar_etiqueta", tag: "VIP" }])).toBe(true);
    expect(ok([{ type: "mudar_status", status: "fechado" }])).toBe(false);
  });
});
