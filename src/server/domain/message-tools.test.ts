import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { sendFromCrm } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { resetDb } from "../../../test/db";
import { saveCasaInfo } from "./client-link/settings";
import { saveFuncao } from "./funcoes";
import { EDIT_WINDOW_MS, editSentMessage, reactToMessage, sendCasaLocation, sendContactCard } from "./message-tools";

/** Provider falso: nenhum teste fala com a Evolution de verdade. */
const calls: { fn: string; args: unknown[] }[] = [];
const rec = (fn: string) => async (...args: unknown[]) => { calls.push({ fn, args }); return { externalId: `OUT-${fn}-${calls.length}` }; };
const base = { createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: rec("sendText") };
const full = { ...base, sendReaction: rec("sendReaction"), editText: rec("editText"), sendLocation: rec("sendLocation"), sendContact: rec("sendContact") };
let uid = "", other = "", dealId = "", chId = "", gestor = "";

beforeEach(async () => {
  calls.length = 0; await resetDb(); setWhatsappProvider(full as never);
  [{ id: uid }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: other }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaise", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: chId, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
});
afterEach(() => setWhatsappProvider(null));

const sentByCrm = async (text = "Olá, tudo bem?", by = uid) => {
  await sendFromCrm(dealId, text, by);
  return (await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"))).orderBy(messages.createdAt)).at(-1)!;
};
const plusMin = (m: Date, n: number) => new Date(m.getTime() + n * 60_000);
const inbound = async () => (await db.select().from(messages).where(eq(messages.direction, "in")))[0];
const reload = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];

describe("reagir", () => {
  it("reagir grava a reação da Casa e reagir de novo com o mesmo emoji tira", async () => {
    const m = await inbound();
    await reactToMessage(m.id, "👍", uid);
    expect(calls.at(-1)).toEqual({ fn: "sendReaction", args: ["rec", "+5571999995555", { externalId: "IN1", fromMe: false }, "👍"] });
    expect((await reload(m.id)).reactions).toEqual({ casa: "👍" });
    await reactToMessage(m.id, "❤️", uid);
    expect((await reload(m.id)).reactions).toEqual({ casa: "❤️" });
    await reactToMessage(m.id, "❤️", uid);
    expect(calls.at(-1)!.args[3]).toBe("");
    expect((await reload(m.id)).reactions).toBeNull();
  });
  it("só aceita os quatro emojis; função desligada recusa; sem a função do provider, nada gravado", async () => {
    const m = await inbound();
    await expect(reactToMessage(m.id, "🔥", uid)).rejects.toThrow("Escolha 👍, ❤️, 🙏 ou 😂.");
    setWhatsappProvider(base as never);
    await expect(reactToMessage(m.id, "👍", uid)).rejects.toThrow("Este WhatsApp ainda não reage a mensagens pelo CRM.");
    expect((await reload(m.id)).reactions).toBeNull();
    setWhatsappProvider(full as never);
    await saveFuncao("reagir", { on: false }, gestor, { confirmouEnvio: false });
    await expect(reactToMessage(m.id, "👍", uid)).rejects.toThrow("Reagir a mensagens está desligada em Configurações › Recursos.");
    expect(calls.filter((c) => c.fn === "sendReaction")).toEqual([]);
  });
});

describe("editar", () => {
  it("editar guarda o texto antigo na auditoria e marca 'Editada'", async () => {
    const m = await sentByCrm("Texto velho");
    await editSentMessage(m.id, "Texto novo", uid, plusMin(m.createdAt, 5));
    const after = await reload(m.id);
    expect(after.editedAt).not.toBeNull();
    expect(after.body).toContain("Texto novo");
    expect(after.body).not.toContain("Texto velho");
    expect(after.body).toMatch(/^\*CATI:?/); // a assinatura da pessoa continua
    const e = calls.find((c) => c.fn === "editText")!;
    expect(e.args.slice(0, 3)).toEqual(["rec", "+5571999995555", m.externalId]);
    expect(e.args[3]).toBe(after.body);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entity, "message"), eq(auditLog.entityId, m.id)));
    expect(log).toMatchObject({ userId: uid, action: "editou_mensagem" });
    expect(JSON.stringify(log.data)).toContain("Texto velho");
  });
  it("editar depois de 15 min é recusado", async () => {
    const m = await sentByCrm();
    expect(EDIT_WINDOW_MS).toBe(15 * 60_000);
    await expect(editSentMessage(m.id, "Novo texto", uid, plusMin(m.createdAt, 16))).rejects.toThrow("Só dá para editar até 15 minutos depois de enviar.");
    expect(calls.some((c) => c.fn === "editText")).toBe(false);
  });
  it("o prazo é o número de Configurações › Recursos (janela_min)", async () => {
    const m = await sentByCrm();
    await saveFuncao("editar_mensagem", { params: { janela_min: 5 } }, gestor, { confirmouEnvio: false });
    await expect(editSentMessage(m.id, "Novo", uid, plusMin(m.createdAt, 6))).rejects.toThrow("Só dá para editar até 5 minutos depois de enviar.");
    await editSentMessage(m.id, "Novo", uid, plusMin(m.createdAt, 4));
    expect((await reload(m.id)).editedAt).not.toBeNull();
  });
  it("função desligada recusa", async () => {
    const m = await sentByCrm();
    await saveFuncao("editar_mensagem", { on: false }, gestor, { confirmouEnvio: false });
    await expect(editSentMessage(m.id, "Novo", uid, plusMin(m.createdAt, 1))).rejects.toThrow("Editar mensagem enviada está desligada em Configurações › Recursos.");
  });
  it("editar mensagem da cliente, automática, de outra pessoa, do celular ou que não é texto é recusado", async () => {
    const now = new Date();
    const [inb] = await db.select().from(messages).where(eq(messages.direction, "in"));
    await expect(editSentMessage(inb.id, "x", uid, now)).rejects.toThrow("Só dá para editar mensagens que a Casa enviou pelo CRM.");
    const mine = await sentByCrm();
    await expect(editSentMessage(mine.id, "x", other, plusMin(mine.createdAt, 1))).rejects.toThrow("Só dá para editar as mensagens que você mesma enviou.");
    const mk = async (o: Partial<typeof messages.$inferInsert>) => (await db.insert(messages).values({ dealId, contactId: inb.contactId, channelId: chId, direction: "out", body: "oi", status: "sent", externalId: `Z${Math.random()}`, sentVia: "crm", sentByUserId: uid, ...o }).returning())[0];
    for (const o of [{ sentByUserId: null }, { sentVia: "celular" as const }, { kind: "image" }, { status: "failed" }, { externalId: null }, { deletedAt: now }]) {
      const m = await mk(o);
      await expect(editSentMessage(m.id, "x", uid, plusMin(m.createdAt, 1))).rejects.toThrow();
    }
    expect(calls.some((c) => c.fn === "editText")).toBe(false);
  });
  it("texto vazio é recusado; provider sem a função: mensagem clara e nada gravado", async () => {
    const m = await sentByCrm("Original");
    await expect(editSentMessage(m.id, "   ", uid, plusMin(m.createdAt, 1))).rejects.toThrow("Escreva o texto da mensagem.");
    setWhatsappProvider(base as never);
    await expect(editSentMessage(m.id, "Novo", uid, plusMin(m.createdAt, 1))).rejects.toThrow("Este WhatsApp ainda não edita mensagens pelo CRM.");
    const after = await reload(m.id);
    expect(after.editedAt).toBeNull(); expect(after.body).toContain("Original");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "editou_mensagem"))).toEqual([]);
  });
});

describe("Como chegar e contato", () => {
  it("sem pino cadastrado: pede o cadastro e não manda nada", async () => {
    await expect(sendCasaLocation(dealId, uid)).rejects.toThrow("Cadastre o pino da Casa em Página da cliente.");
    expect(calls.some((c) => c.fn === "sendLocation")).toBe(false);
  });
  it("Como chegar manda o pino com o nome e o endereço da Casa e aparece na conversa como Localização", async () => {
    await saveCasaInfo({ endereco: "Rua das Flores, 10 - Pituba", whatsapp: null, latitude: -12.9714, longitude: -38.5014 }, gestor);
    await sendCasaLocation(dealId, uid);
    expect(calls.at(-1)).toEqual({ fn: "sendLocation", args: ["rec", "+5571999995555", { name: "Casa Fiaes", address: "Rua das Flores, 10 - Pituba", latitude: -12.9714, longitude: -38.5014 }] });
    const m = (await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.kind, "location"))))[0];
    expect(m).toMatchObject({ direction: "out", status: "sent", sentByUserId: uid, sentVia: "crm" });
    expect(m.externalId).toMatch(/^OUT-sendLocation/);
    expect(m.body).toContain("Casa Fiaes");
  });
  it("o nome do pino vem de Configurações › Recursos", async () => {
    await saveCasaInfo({ endereco: "Rua A", whatsapp: null, latitude: 1, longitude: 2 }, gestor);
    await saveFuncao("como_chegar", { textos: { nome_pino: "Salão Fiaes Pituba" } }, gestor, { confirmouEnvio: false });
    await sendCasaLocation(dealId, uid);
    expect((calls.at(-1)!.args[2] as { name: string }).name).toBe("Salão Fiaes Pituba");
  });
  it("mandar contato envia o cartão e grava como Contato", async () => {
    await sendContactCard(dealId, { fullName: " Recepção Casa Fiaes ", phoneE164: "71 98888-7777" }, uid);
    expect(calls.at(-1)).toEqual({ fn: "sendContact", args: ["rec", "+5571999995555", { fullName: "Recepção Casa Fiaes", phoneE164: "+5571988887777" }] });
    const m = (await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.kind, "contact"))))[0];
    expect(m).toMatchObject({ direction: "out", status: "sent", sentByUserId: uid });
    expect(m.body).toBe("Recepção Casa Fiaes · +5571988887777");
    await expect(sendContactCard(dealId, { fullName: "", phoneE164: "71 98888-7777" }, uid)).rejects.toThrow("Escreva o nome do contato.");
    await expect(sendContactCard(dealId, { fullName: "Fulana", phoneE164: "123" }, uid)).rejects.toThrow("Telefone inválido. Use DDD + número.");
  });
  it("funções desligadas recusam; WhatsApp sem a função: mensagem clara e nada gravado", async () => {
    await saveCasaInfo({ endereco: "Rua A", whatsapp: null, latitude: 1, longitude: 2 }, gestor);
    setWhatsappProvider(base as never);
    await expect(sendCasaLocation(dealId, uid)).rejects.toThrow("Este WhatsApp ainda não envia localização pelo CRM.");
    await expect(sendContactCard(dealId, { fullName: "Fulana", phoneE164: "71988887777" }, uid)).rejects.toThrow("Este WhatsApp ainda não envia contato pelo CRM.");
    expect(await db.select().from(messages).where(eq(messages.kind, "location"))).toEqual([]);
    expect(await db.select().from(messages).where(eq(messages.kind, "contact"))).toEqual([]);
    setWhatsappProvider(full as never);
    await saveFuncao("como_chegar", { on: false }, gestor, { confirmouEnvio: false });
    await saveFuncao("mandar_contato", { on: false }, gestor, { confirmouEnvio: false });
    await expect(sendCasaLocation(dealId, uid)).rejects.toThrow("Como chegar está desligada em Configurações › Recursos.");
    await expect(sendContactCard(dealId, { fullName: "Fulana", phoneE164: "71988887777" }, uid)).rejects.toThrow("Mandar contato está desligada em Configurações › Recursos.");
    expect(calls.filter((c) => c.fn === "sendLocation" || c.fn === "sendContact")).toEqual([]);
  });
});
