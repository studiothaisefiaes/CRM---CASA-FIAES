import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, messages, webhookEvents } from "../db/schema";
import { ingestEvolution } from "./webhook";
import { reconcileMissedMessages, type StoredEvoMessage } from "./reconcile";
import { resetDb } from "../../../test/db";

// Queda do banco de 22/10 (14:55–15:11): a Evolution guardou as mensagens, mas os webhooks daquele intervalo não entraram no CRM.
const NOW = new Date("2026-10-24T13:00:00Z");
const sec = (minAgo: number) => Math.floor(NOW.getTime() / 1000) - minAgo * 60;
const row = (id: string, minAgo: number, text = "Oi, tem horário amanhã?", fromMe = false): StoredEvoMessage => ({
  instance: "rec", key: { remoteJid: "5571911110001@s.whatsapp.net", fromMe, id }, pushName: "Paula", message: { conversation: text },
  messageType: "conversation", messageTimestamp: sec(minAgo), status: "DELIVERY_ACK",
});
const src = (rows: StoredEvoMessage[]) => ({ recent: async () => rows });

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
});

it("mensagem que está na Evolution e não entrou no CRM é registrada com o horário dela; a segunda rodada não repete", async () => {
  const r = await reconcileMissedMessages(NOW, src([row("E1", 40)]));
  expect(r).toMatchObject({ checked: 1, replayed: 1 });
  const [m] = await db.select().from(messages);
  // O segundo da mensagem; o milésimo depende do relógio de verdade (chegou atrasada = fim do segundo, webhook.ts messageTime).
  expect([m.externalId, m.direction, m.body, Math.floor(m.createdAt.getTime() / 1000)]).toEqual(["E1", "in", "Oi, tem horário amanhã?", sec(40)]);
  expect((await reconcileMissedMessages(NOW, src([row("E1", 40)]))).replayed).toBe(0);
  expect(await db.select().from(messages)).toHaveLength(1);
});

it("o que já entrou (mensagem gravada ou evento recebido, mesmo ignorado como reação) não é repetido", async () => {
  await ingestEvolution({ event: "messages.upsert", instance: "rec", data: row("E2", 30) as never });
  await ingestEvolution({ event: "messages.upsert", instance: "rec", data: { ...row("R1", 20), message: { reactionMessage: { key: { id: "E2" }, text: "❤️" } } } as never });
  const before = (await db.select().from(webhookEvents)).length;
  const r = await reconcileMissedMessages(NOW, src([row("E2", 30), { ...row("R1", 20), message: { reactionMessage: { key: { id: "E2" }, text: "❤️" } } }]));
  expect(r.replayed).toBe(0);
  expect((await db.select().from(webhookEvents)).length).toBe(before);
});

it("canal em modo quieto (QR lido agora) ou com histórico ainda na fila: espera, não puxa nada", async () => {
  await db.update(channels).set({ quietUntil: new Date(NOW.getTime() + 3600_000) });
  expect(await reconcileMissedMessages(NOW, src([row("E3", 40)]))).toMatchObject({ replayed: 0, skipped: 1 });
  await db.update(channels).set({ quietUntil: null });
  await db.insert(webhookEvents).values({ provider: "evolution", externalId: "set-1", event: "messages.set", payload: { event: "messages.set", instance: "rec", data: [] } });
  expect(await reconcileMissedMessages(NOW, src([row("E3", 40)]))).toMatchObject({ replayed: 0, skipped: 1 });
  expect(await db.select().from(messages)).toHaveLength(0);
});

it("instância que não é de nenhum canal do CRM é ignorada", async () => {
  expect(await reconcileMissedMessages(NOW, src([{ ...row("E4", 40), instance: "outra" }]))).toMatchObject({ replayed: 0 });
  expect(await db.select().from(messages)).toHaveLength(0);
});

it("sem acesso ao banco da Evolution (sem EVOLUTION_DATABASE_URL): não faz nada", async () => {
  expect(await reconcileMissedMessages(NOW, { recent: async () => null })).toEqual({ checked: 0, replayed: 0, skipped: 0 });
});

it("pega a janela certa: de 6 h atrás até 2 min atrás", async () => {
  let args: [number, number] | null = null;
  await reconcileMissedMessages(NOW, { recent: async (from, to) => { args = [from, to]; return []; } });
  expect(args).toEqual([sec(360), sec(2)]);
  expect((await db.select().from(messages).where(eq(messages.externalId, "x"))).length).toBe(0);
});

it("lote de histórico que esgotou as tentativas não trava a conferência do canal (revisão 24/10)", async () => {
  const { MAX_ATTEMPTS } = await import("./webhook");
  await db.insert(webhookEvents).values({ provider: "evolution", externalId: "set-morto", event: "messages.set", attempts: MAX_ATTEMPTS, payload: { event: "messages.set", instance: "rec", data: [] } });
  expect(await reconcileMissedMessages(NOW, src([row("E5", 40)]))).toMatchObject({ replayed: 1, skipped: 0 });
});

it("reação, edição e voto perdidos não são reenviados: fora de ordem, passariam por cima de um mais novo", async () => {
  const vote = { ...row("V1", 30), message: { pollUpdateMessage: { pollCreationMessageKey: { id: "P1" }, vote: { selectedOptions: ["Preciso remarcar"] } } } };
  const reac = { ...row("R2", 30), message: { reactionMessage: { key: { id: "X" }, text: "❤️" } } };
  const edit = { ...row("ED1", 30), message: { protocolMessage: { type: 14, key: { id: "X" }, editedMessage: { conversation: "novo" } } } };
  expect(await reconcileMissedMessages(NOW, src([vote, reac, edit]))).toMatchObject({ replayed: 0 });
  expect(await db.select().from(webhookEvents)).toHaveLength(0);
});

it("a cliente que veio de anúncio (contextInfo na coluna própria da Evolution) abre o lead com origem Anúncio", async () => {
  const { deals } = await import("../db/schema");
  await reconcileMissedMessages(NOW, src([{ ...row("AD1", 40), contextInfo: { externalAdReply: { title: "Promo" }, ctwaClid: "abc" } }]));
  const [d] = await db.select().from(deals);
  expect(d.origin).toBe("Anúncio");
});
