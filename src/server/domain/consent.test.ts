import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, contacts, deals, messages, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { drainOutbox, enqueueAutomated } from "./outbox";
import { scheduleMessage } from "./scheduled";
import { previewAudience } from "./campaigns";
import { claimSuggestion } from "../ai/suggest";
import { saveAiSettings } from "../ai/settings";
import { saveFuncao } from "./funcoes";
import { UserFacingError } from "./errors";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { automationBlockReason, saveConsent, setAutomationsPaused } from "./consent";
import { PAUSED_REASON, tomorrowStartBahia } from "@/lib/consent";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const OPEN_TIME = new Date("2026-10-20T13:00:00Z"); // terça 10:00 em Salvador
const NOW = OPEN_TIME;
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: `OUT${sent.length}` }; },
};
let uid = "", dealId = "", contactId = "", chId = "";
const outboxRows = () => db.select().from(outbox);
const contactRow = async () => (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0];
async function wrote(name: string, phone: string) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone }).returning();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-09-01T13:00:00Z") });
  return c.id;
}

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: uid }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: chId, externalId: "IN1", phoneRaw: "71999990021", pushName: "Cliente Teste", body: "Oi", at: new Date(NOW.getTime() - 300_000), now: new Date(NOW.getTime() - 300_000) });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  setWhatsappProvider(fake);
});
afterEach(() => { setWhatsappProvider(null); vi.unstubAllEnvs(); });

describe("Automáticas pausadas (central, no envio)", () => {
  it("item enfileirado ANTES da pausa não sai depois dela (lembrete, menu, regra)", async () => {
    for (const source of ["lembrete_d1:v1:2026-10-21T13:00:00.000Z", "menu_boas_vindas", "automacao:abc"]) await enqueueAutomated({ dealId, kind: "text", text: "Olá", source });
    await setAutomationsPaused(contactId, "sempre", uid);
    const r = await drainOutbox(OPEN_TIME);
    expect(r.cancelled).toBe(3);
    expect(sent).toEqual([]);
    expect((await outboxRows()).every((o) => o.error === "As automáticas desta cliente estão pausadas.")).toBe(true);
  });

  it("a mensagem programada à mão (agendada) sai mesmo com a pausa", async () => {
    const at = new Date(OPEN_TIME.getTime() + 10 * 60_000);
    await scheduleMessage({ dealId, text: "Confirma amanhã?", at, cancelIfReply: false }, uid, OPEN_TIME);
    await setAutomationsPaused(contactId, "sempre", uid);
    const r = await drainOutbox(new Date(at.getTime() + 60_000));
    expect(r.sent).toBe(1);
    expect(sent.some((t) => t.includes("Confirma amanhã?"))).toBe(true);
  });

  it("pausa até amanhã: no dia seguinte volta a valer sozinha", async () => {
    const until = tomorrowStartBahia(NOW);
    expect(until.toISOString()).toBe("2026-10-21T03:00:00.000Z");
    await setAutomationsPaused(contactId, until, uid);
    await enqueueAutomated({ dealId, kind: "text", text: "Hoje não", source: "automacao:abc" });
    expect((await drainOutbox(OPEN_TIME)).cancelled).toBe(1);
    await enqueueAutomated({ dealId, kind: "text", text: "Amanhã sim" });
    const amanha = new Date("2026-10-21T13:00:00Z");
    expect((await drainOutbox(amanha)).sent).toBe(1);
    expect(sent).toEqual(["Amanhã sim"]);
  });

  it("tomorrowStartBahia: às 23h de Salvador ainda é amanhã 00:00 de Salvador", () => {
    expect(tomorrowStartBahia(new Date("2026-10-21T02:00:00Z")).toISOString()).toBe("2026-10-21T03:00:00.000Z"); // 20/10 23:00 Bahia
  });

  it("automationBlockReason: sem pausa, pausa vencida e pausa vigente", async () => {
    expect(automationBlockReason({ automationsPausedUntil: null }, NOW)).toBeNull();
    expect(automationBlockReason({ automationsPausedUntil: new Date(NOW.getTime() - 1) }, NOW)).toBeNull();
    expect(automationBlockReason({ automationsPausedUntil: new Date(NOW.getTime() + 1) }, NOW)).toBe(PAUSED_REASON);
    await setAutomationsPaused(contactId, "sempre", uid);
    expect(automationBlockReason(await contactRow(), NOW)).toBe(PAUSED_REASON);
    await setAutomationsPaused(contactId, null, uid);
    expect(automationBlockReason(await contactRow(), NOW)).toBeNull();
  });

  it("pausa já gravada continua valendo com a função desligada; ligar/desligar a pausa com ela desligada é recusado", async () => {
    await setAutomationsPaused(contactId, "sempre", uid);
    await saveFuncao("pausa_automaticas", { on: false }, uid);
    await enqueueAutomated({ dealId, kind: "text", text: "x", source: "automacao:abc" });
    expect((await drainOutbox(OPEN_TIME)).cancelled).toBe(1);
    await expect(setAutomationsPaused(contactId, null, uid)).rejects.toThrow(UserFacingError);
    await expect(setAutomationsPaused(contactId, "sempre", uid)).rejects.toThrow(/desligada em Configurações › Recursos/);
  });

  it("auditoria da pausa: de/para", async () => {
    await setAutomationsPaused(contactId, "sempre", uid);
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "pausa_automaticas"));
    expect(a).toMatchObject({ userId: uid, entity: "contact", entityId: contactId, data: { de: null, para: "sempre" } });
  });
});

describe("Consentimento", () => {
  it("gravar o consentimento audita quem mudou, de e para", async () => {
    await saveConsent(contactId, { whatsapp: false, cpfNota: true }, uid);
    await saveConsent(contactId, { whatsapp: true }, uid);
    const c = await contactRow();
    expect(c).toMatchObject({ consentWhatsapp: true, consentAi: null, consentCpfNota: true, consentBy: uid });
    expect(c.consentAt).toBeInstanceOf(Date);
    const logs = (await db.select().from(auditLog).where(eq(auditLog.action, "consentimento"))).sort((a, b) => +a.createdAt - +b.createdAt);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ userId: uid, entity: "contact", entityId: contactId, data: { de: { whatsapp: null, cpfNota: null }, para: { whatsapp: false, cpfNota: true } } });
    expect(logs[1].data).toEqual({ de: { whatsapp: false }, para: { whatsapp: true } });
  });

  it("sem mudança nada é gravado nem auditado", async () => {
    await saveConsent(contactId, { ai: null }, uid);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "consentimento"))).toHaveLength(0);
    expect((await contactRow()).consentAt).toBeNull();
  });

  it("função desligada recusa gravar; o 'Não' já gravado continua valendo", async () => {
    const naoQuer = await wrote("Ana Teste", "+5571999990071");
    await saveConsent(naoQuer, { whatsapp: false, ai: false }, uid);
    await saveFuncao("consentimento", { on: false }, uid);
    await expect(saveConsent(naoQuer, { whatsapp: true }, uid)).rejects.toThrow(/desligada em Configurações › Recursos/);
    expect((await previewAudience({ contactIds: [naoQuer] })).excluded).toContainEqual(expect.objectContaining({ reason: "sem_consentimento", n: 1 }));
  });

  it("massa: 'Não' em campanhas por WhatsApp fica de fora com o motivo próprio; não sabe e 'Sim' entram", async () => {
    const naoQuer = await wrote("Ana Teste", "+5571999990071");
    const naoPerguntado = await wrote("Bia Teste", "+5571999990072");
    const quer = await wrote("Carla Teste", "+5571999990073");
    await saveConsent(naoQuer, { whatsapp: false }, uid);
    await saveConsent(quer, { whatsapp: true }, uid);
    const p = await previewAudience({ contactIds: [naoQuer, naoPerguntado, quer] });
    expect(p.eligible).toBe(2);
    expect(p.excluded).toContainEqual(expect.objectContaining({ reason: "sem_consentimento", n: 1, label: "disseram Não a campanhas por WhatsApp" }));
  });

  it("massa: cliente pausada fica de fora (pausa vencida entra)", async () => {
    const pausada = await wrote("Ana Teste", "+5571999990071");
    const vencida = await wrote("Bia Teste", "+5571999990072");
    await setAutomationsPaused(pausada, "sempre", uid);
    await setAutomationsPaused(vencida, new Date(NOW.getTime() - 3_600_000), uid);
    const p = await previewAudience({ contactIds: [pausada, vencida] }, NOW);
    expect(p.eligible).toBe(1);
    expect(p.excluded).toContainEqual(expect.objectContaining({ reason: "pausada", n: 1, label: "com as automáticas pausadas" }));
  });

  it("IA: cliente que disse Não ao atendimento por IA não gera sugestão nem manda dado para a IA", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-teste-falsa");
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1/messages");
    await saveAiSettings({ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500 }, uid);
    await saveConsent(contactId, { ai: false }, uid);
    expect(await claimSuggestion(dealId, { now: NOW })).toEqual({ status: "pulada", motivo: "sem_consentimento_ia" });
    await saveConsent(contactId, { ai: true }, uid);
    expect((await claimSuggestion(dealId, { now: NOW })).status).toBe("reservada");
  });
});
