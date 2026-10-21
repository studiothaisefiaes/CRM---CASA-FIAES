import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, automations, lists, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { saveAutomation, toggleAutomation, restoreAutomation } from "./config";
import { AUTOMATION_TEMPLATES } from "../rules/templates";
import {
  getAutoReply, saveAutoReply, getSendCap, saveSendCap, getMediaRetentionMonths, saveMediaRetention, saveServiceCycleDays,
} from "./messaging-settings";

let gestor: string;
beforeEach(async () => {
  await resetDb();
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});
const auditOf = (entity: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entity, entity), eq(auditLog.action, action)));

describe("resposta fora do horário", () => {
  it("nasce desligada e vazia", async () => { expect(await getAutoReply()).toEqual({ enabled: false, text: "" }); });
  it("liga com texto e registra quem ligou (a confirmação é da tela, não bloqueio do servidor)", async () => {
    await saveAutoReply({ enabled: true, text: "Estamos fechados, voltamos às 8h." }, gestor);
    expect(await getAutoReply()).toEqual({ enabled: true, text: "Estamos fechados, voltamos às 8h." });
    const [a] = await auditOf("settings", "ligou");
    expect(a.userId).toBe(gestor);
  });
  it("recusa ligar sem texto e texto acima de 500 caracteres", async () => {
    await expect(saveAutoReply({ enabled: true, text: "  " }, gestor)).rejects.toThrow();
    await expect(saveAutoReply({ enabled: false, text: "a".repeat(501) }, gestor)).rejects.toThrow();
    await saveAutoReply({ enabled: false, text: "a".repeat(500) }, gestor);
  });
  it("desligar registra auditoria", async () => {
    await saveAutoReply({ enabled: true, text: "Fechado por hoje." }, gestor);
    await saveAutoReply({ enabled: false, text: "Fechado por hoje." }, gestor);
    expect(await auditOf("settings", "desligou")).toHaveLength(1);
  });
});

describe("teto de envios por hora", () => {
  it("padrão 30; aceita de 1 a 200", async () => {
    expect(await getSendCap()).toBe(30);
    await saveSendCap(1, gestor); expect(await getSendCap()).toBe(1);
    await saveSendCap(200, gestor); expect(await getSendCap()).toBe(200);
  });
  it.each([0, 201, -5, 2.5, NaN, "30", null])("recusa %s", async (v) => { await expect(saveSendCap(v, gestor)).rejects.toThrow(); });
});

describe("retenção de mídia", () => {
  it("padrão 'Não apagar' (null) até a gestão escolher; aceita 6, 12, 24 e nunca", async () => {
    expect(await getMediaRetentionMonths()).toBeNull();
    await saveMediaRetention(6, gestor); expect(await getMediaRetentionMonths()).toBe(6);
    await saveMediaRetention("nunca", gestor); expect(await getMediaRetentionMonths()).toBeNull();
    await saveMediaRetention(24, gestor); expect(await getMediaRetentionMonths()).toBe(24);
  });
  it.each([0, 3, 13, "sempre", null])("recusa %s", async (v) => { await expect(saveMediaRetention(v, gestor)).rejects.toThrow(); });
});

describe("ciclo de retorno do serviço", () => {
  const svc = async (label = "Coloração") => (await db.select().from(lists).where(and(eq(lists.kind, "service"), eq(lists.label, label))))[0];
  it("salva dias, 0/vazio limpa, e audita", async () => {
    const s = await svc();
    await saveServiceCycleDays(s.id, 45, gestor);
    expect((await svc()).cycleDays).toBe(45);
    await saveServiceCycleDays(s.id, 0, gestor);
    expect((await svc()).cycleDays).toBeNull();
    await saveServiceCycleDays(s.id, 365, gestor);
    await saveServiceCycleDays(s.id, null, gestor);
    expect((await svc()).cycleDays).toBeNull();
    expect((await auditOf("list", "editou")).length).toBe(4);
  });
  it("recusa mais de 365, negativo, fracionado e item que não é serviço", async () => {
    const s = await svc();
    for (const v of [366, -1, 1.5, "7"]) await expect(saveServiceCycleDays(s.id, v, gestor)).rejects.toThrow();
    const [obj] = await db.select().from(lists).where(eq(lists.kind, "objection"));
    await expect(saveServiceCycleDays(obj.id, 30, gestor)).rejects.toThrow();
    expect((await db.select().from(lists).where(eq(lists.id, obj.id)))[0].cycleDays).toBeNull();
  });
});

describe("automações com envio: auditoria", () => {
  it("modelo salvo desligado e ligado depois registra quem ligou, marcando que envia", async () => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === "aniversario")!;
    const id = await saveAutomation(null, t.rule, gestor);
    expect((await db.select().from(automations).where(eq(automations.id, id)))[0].enabled).toBe(false);
    await toggleAutomation(id, true, gestor, { confirmouEnvio: true });
    const [a] = await auditOf("automation", "ligou");
    expect(a.userId).toBe(gestor);
    expect(a.data).toMatchObject({ envia: true });
  });
});

describe("restaurar versão", () => {
  it("grava desligada quando o snapshot tem ação de envio, sem ligar o envio por trás", async () => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === "aniversario")!;
    const id = await saveAutomation(null, { ...t.rule, enabled: true }, gestor, { confirmouEnvio: true }); // v1: ligada, com envio
    await saveAutomation(id, { ...t.rule, enabled: true, actions: [{ type: "alertar_gestao", message: "Aniversário de {nome}" }] }, gestor); // v2
    await restoreAutomation(id, 1, gestor);
    const [cur] = await db.select().from(automations).where(eq(automations.id, id));
    expect(cur.enabled).toBe(false);
    expect(JSON.stringify(cur.actions)).toContain("enviar_mensagem");
  });
  it("sem envio no snapshot, mantém o estado do snapshot", async () => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === "parado-alerta")!;
    const id = await saveAutomation(null, { ...t.rule, enabled: true }, gestor);
    await saveAutomation(id, { ...t.rule, enabled: false }, gestor);
    await restoreAutomation(id, 1, gestor);
    expect((await db.select().from(automations).where(eq(automations.id, id)))[0].enabled).toBe(true);
  });
});
