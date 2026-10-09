import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, messages, stages, users } from "../db/schema";
import { ingestEvolution, processHistoryEvents } from "./webhook";
import { setWhatsappProvider } from "./evolution";
import { sendFromCrm } from "../domain/send";
import { resetDb } from "../../../test/db";

// Bugs achados com o número real em 09/10: envio preso a canal removido, mensagens do celular descartadas, histórico ignorado.
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const msg = (id: string, jid: string, fromMe: boolean, text: string, at: Date, pushName = "Cliente") =>
  ({ key: { remoteJid: jid, fromMe, id }, pushName: fromMe ? "Você" : pushName, message: { conversation: text }, messageType: "conversation", messageTimestamp: sec(at) });
const stageOf = async (dealId: string) =>
  (await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].key;

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" });
});
afterEach(() => setWhatsappProvider(null));

describe("número real conectado", () => {
  it("mensagem que a Casa manda pelo celular para alguém novo vira lead (em Atendimento) com a mensagem", async () => {
    await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
    await ingestEvolution({ event: "messages.upsert", instance: "rec", data: msg("P1", "557181110087@s.whatsapp.net", true, "Me manda uma mensagem aí", new Date()) });
    const [c] = await db.select().from(contacts);
    expect(c.phoneE164).toBe("+5571981110087");
    const [d] = await db.select().from(deals);
    expect(await stageOf(d.id)).toBe("atendimento");
    expect(d.awaitingReplySince).toBeNull();
    const [m] = await db.select().from(messages);
    expect(m).toMatchObject({ dealId: d.id, direction: "out", body: "Me manda uma mensagem aí", fromPhone: true });
  });

  it("lead preso a um canal removido responde pelo mesmo número conectado em outro canal", async () => {
    const [old] = await db.insert(channels).values({ name: "Comercial (removido)", instanceName: "com", status: "desconectado", phone: "+557199990404" }).returning();
    const [rec] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
    await ingestEvolution({ event: "messages.upsert", instance: "com", data: msg("I1", "557199910009@s.whatsapp.net", false, "Oi", new Date(), "Elaine") });
    const [d] = await db.select().from(deals);
    expect(d.channelId).toBe(old.id);
    let usedInstance = "";
    setWhatsappProvider({ createInstance: async () => {}, connect: async () => ({ status: "conectado" }), state: async () => "conectado", logout: async () => {}, remove: async () => {},
      syncWebhook: async () => {}, sendText: async (inst) => { usedInstance = inst; return { externalId: "E1" }; } });
    const [u] = await db.select().from(users);
    await sendFromCrm(d.id, "Oi, Elaine!", u.id);
    expect(usedInstance).toBe("rec");
    expect((await db.select().from(deals))[0].channelId).toBe(rec.id);
  });

  it("número reconectado em outro canal assume os leads abertos do canal antigo do mesmo número", async () => {
    const [old] = await db.insert(channels).values({ name: "Comercial", instanceName: "com", status: "desconectado", phone: "+557199990404" }).returning();
    const [rec] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "aguardando_qr" }).returning();
    await ingestEvolution({ event: "messages.upsert", instance: "com", data: msg("I1", "557199910009@s.whatsapp.net", false, "Oi", new Date()) });
    expect((await db.select().from(deals))[0].channelId).toBe(old.id);
    await ingestEvolution({ event: "connection.update", instance: "rec", data: { state: "open", wuid: "557199990404@s.whatsapp.net" } });
    expect((await db.select().from(deals))[0].channelId).toBe(rec.id);
  });

  it("histórico do WhatsApp (messages.set) vira leads com as conversas, sem disparar atraso em conversa antiga", async () => {
    await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
    const now = Date.now(), h = 3_600_000, day = 24 * h;
    const r = await ingestEvolution({ event: "messages.set", instance: "rec", data: [
      // conversa recente: cliente escreveu, Casa respondeu, cliente escreveu de novo há 1 h → esperando resposta
      msg("A1", "5571911110001@s.whatsapp.net", false, "Oi, qual o valor?", new Date(now - 3 * h), "Ana Paula"),
      msg("A2", "5571911110001@s.whatsapp.net", true, "Oi Ana! A avaliação é gratuita.", new Date(now - 2 * h)),
      msg("A3", "5571911110001@s.whatsapp.net", false, "Pode ser amanhã?", new Date(now - 1 * h), "Ana Paula"),
      // conversa de 5 dias atrás que a cliente deixou sem resposta: vira lead, mas sem cronômetro de atraso
      msg("B1", "5571922220002@s.whatsapp.net", false, "Vocês atendem sábado?", new Date(now - 5 * day), "Bruna"),
      // conversa de 4 meses atrás: entra como contato com histórico, sem lead aberto
      msg("C1", "5571933330003@s.whatsapp.net", false, "Obrigada!", new Date(now - 120 * day), "Carla"),
      // grupo e status são ignorados
      msg("G1", "120363000000000000@g.us", false, "msg de grupo", new Date(now - h)),
      msg("S1", "status@broadcast", false, "status", new Date(now - h)),
    ] });
    expect(r).toMatchObject({ ok: true, queued: true }); // lote grande: processa fora da requisição
    await processHistoryEvents();

    const all = await db.select({ d: deals, phone: contacts.phoneE164, name: contacts.name }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId));
    expect(all.length).toBe(2);
    const ana = all.find((x) => x.phone === "+5571911110001")!;
    expect(ana.name).toBe("Ana Paula");
    expect(await stageOf(ana.d.id)).toBe("atendimento");
    expect(ana.d.awaitingReplySince?.getTime()).toBe(sec(new Date(now - h)) * 1000);
    const bruna = all.find((x) => x.phone === "+5571922220002")!;
    expect(await stageOf(bruna.d.id)).toBe("lead");
    expect(bruna.d.awaitingReplySince).toBeNull();

    const msgs = await db.select().from(messages);
    expect(msgs.length).toBe(5);
    expect(msgs.filter((m) => m.dealId === ana.d.id).length).toBe(3);
    const carla = msgs.find((m) => m.externalId === "C1")!;
    expect(carla.dealId).toBeNull();
    expect((await db.select().from(contacts)).length).toBe(3);

    // reprocessar o mesmo lote não duplica nada
    await ingestEvolution({ event: "messages.set", instance: "rec", data: [msg("A1", "5571911110001@s.whatsapp.net", false, "Oi, qual o valor?", new Date(now - 3 * h))] });
    await processHistoryEvents();
    expect((await db.select().from(messages)).length).toBe(5);
    expect((await db.select().from(deals)).length).toBe(2);
  });

  it("conversa do número com ele mesmo (anotações) não vira lead, nem ao vivo nem no histórico", async () => {
    await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
    await ingestEvolution({ event: "send.message", instance: "rec", data: msg("ME1", "557199990404@s.whatsapp.net", true, "nota pra mim", new Date()) });
    await ingestEvolution({ event: "messages.set", instance: "rec", data: [msg("ME2", "557199990404@s.whatsapp.net", true, "outra nota", new Date())] });
    await processHistoryEvents();
    expect((await db.select().from(deals)).length).toBe(0);
    expect((await db.select().from(messages)).length).toBe(0);
  });

  it("histórico de quem já tem lead aberto entra no mesmo lead", async () => {
    await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
    await ingestEvolution({ event: "messages.upsert", instance: "rec", data: msg("N1", "5571911110001@s.whatsapp.net", false, "Oi de novo", new Date(), "Ana Paula") });
    await ingestEvolution({ event: "messages.set", instance: "rec", data: [msg("O1", "5571911110001@s.whatsapp.net", false, "Mensagem antiga", new Date(Date.now() - 86_400_000))] });
    await processHistoryEvents();
    expect((await db.select().from(deals)).length).toBe(1);
    const [d] = await db.select().from(deals);
    expect((await db.select().from(messages)).every((m) => m.dealId === d.id)).toBe(true);
  });
});
