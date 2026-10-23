import { afterEach, beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { channels, deals, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { sendFromCrm, UNCERTAIN_SEND_MESSAGE } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ingestEvolution } from "../whatsapp/webhook";
import { resetDb } from "../../../test/db";

let uid = "", dealId = "";
const outs = () => db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out")));
const provider = (sendText: (...a: unknown[]) => Promise<{ externalId: string | null }>) => setWhatsappProvider({
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {}, sendText } as never);

beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
});
afterEach(() => setWhatsappProvider(null));

it("a Evolution estoura o tempo DEPOIS de enviar e o eco já marcou a mensagem: fica enviada, sem erro e sem 'falhou' (23/10)", async () => {
  provider(async () => {
    // O eco do WhatsApp chega antes da resposta (o webhook reivindica a linha pendente).
    await db.update(messages).set({ status: "sent", externalId: "ECO1" }).where(and(eq(messages.dealId, dealId), eq(messages.status, "pending")));
    throw new Error("timeout");
  });
  await sendFromCrm(dealId, "Seu horário está confirmado", uid);
  const rows = await outs();
  expect(rows.map((m) => [m.status, m.externalId])).toEqual([["sent", "ECO1"]]);
});

it("estourou o tempo e o eco não veio: 'falhou' com o aviso de conferir no WhatsApp antes de reenviar (pode ter saído)", async () => {
  provider(async () => { throw new Error("timeout"); });
  await expect(sendFromCrm(dealId, "Oi", uid)).rejects.toThrow(UNCERTAIN_SEND_MESSAGE);
  const [m] = await outs();
  expect([m.status, m.error]).toEqual(["failed", UNCERTAIN_SEND_MESSAGE]);
});

it("envio incerto cujo eco chega DEPOIS: vira enviada e conta como resposta (sai da espera), sem balão duplicado (revisão 23/10)", async () => {
  provider(async () => { throw new Error("timeout"); });
  await expect(sendFromCrm(dealId, "Seu horário está confirmado", uid)).rejects.toThrow(UNCERTAIN_SEND_MESSAGE);
  const [failed] = await outs();
  expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
  await ingestEvolution({ event: "send.message", instance: "rec", data: { key: { remoteJid: "5571999995555@s.whatsapp.net", fromMe: true, id: "ECO9" }, message: { conversation: failed.body ?? "" }, messageTimestamp: Math.floor(Date.now() / 1000) } });
  const rows = await outs();
  expect(rows.map((m) => [m.id, m.status, m.externalId, m.error, m.sentByUserId])).toEqual([[failed.id, "sent", "ECO9", null, uid]]);
  expect((await db.select().from(deals))[0].awaitingReplySince).toBeNull();
});
