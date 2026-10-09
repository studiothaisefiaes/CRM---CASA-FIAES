import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, dealEvents, deals, messages, stages, users, webhookEvents } from "../db/schema";
import { ingestEvolution, parseContent, retryFailedWebhooks } from "./webhook";
import { setWhatsappProvider } from "./evolution";
import { checkConnections } from "./watchdog";
import { normalizePhone } from "../domain/phone";
import { resetDb } from "../../../test/db";

// Achados da auditoria com o número real (09/10): cada teste reproduz um caso que aconteceu de verdade.
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const up = (id: string, fromMe: boolean, message: Record<string, unknown>, at = new Date(), jid = "5571999812244@s.whatsapp.net") =>
  ({ event: "messages.upsert", instance: "rec", data: { key: { remoteJid: jid, fromMe, id }, pushName: fromMe ? "Você" : "Mariana", message, messageTimestamp: sec(at) } });
const text = (t: string) => ({ conversation: t });
const stageOf = async () => (await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)))[0].key;

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
});
afterEach(() => setWhatsappProvider(null));

describe("auditoria do número real", () => {
  it("mensagem da Casa processada atrasada (mais antiga que a da cliente) não zera a espera nem conta como resposta", async () => {
    const t = Date.now() - 10 * 60_000;
    await ingestEvolution(up("CLI", false, text("Hh"), new Date(t + 12_000)));
    await ingestEvolution(up("CASA", true, text("Me manda uma mensagem aí"), new Date(t)));
    const [d] = await db.select().from(deals);
    expect(d.awaitingReplySince?.getTime()).toBe(sec(new Date(t + 12_000)) * 1000);
    expect(await db.select().from(dealEvents).where(eq(dealEvents.type, "resposta"))).toHaveLength(0);
    expect(await stageOf()).toBe("lead");
    expect((await db.select().from(messages)).length).toBe(2);
  });

  it("número estrangeiro vindo do WhatsApp (+1) não vira número brasileiro", () => {
    expect(normalizePhone("17015557208@s.whatsapp.net")).toBe("+17015557208");
    expect(normalizePhone("12025550123@s.whatsapp.net")).toBe("+12025550123");
    expect(normalizePhone("557181110087@s.whatsapp.net")).toBe("+5571981110087"); // brasileiro antigo continua ganhando o 9
    expect(normalizePhone("71 98111-0087")).toBe("+5571981110087"); // digitado sem país continua Brasil
  });

  it("status de entrega que chega antes da mensagem é aplicado quando ela chega", async () => {
    await ingestEvolution({ event: "messages.update", instance: "rec", data: { keyId: "LATE1", status: "READ" } });
    await ingestEvolution(up("CLI0", false, text("oi")));
    await ingestEvolution(up("LATE1", true, text("Oi, tudo bem?")));
    await db.update(webhookEvents).set({ receivedAt: new Date(Date.now() - 60_000) });
    await retryFailedWebhooks();
    const m = (await db.select().from(messages)).find((x) => x.externalId === "LATE1")!;
    expect(m.status).toBe("read");
  });

  it("evento de conexão antigo reprocessado não derruba o canal", async () => {
    await db.insert(webhookEvents).values({ provider: "evolution", externalId: "old-close", event: "connection.update", receivedAt: new Date(Date.now() - 120_000),
      payload: { event: "connection.update", instance: "rec", data: { state: "close", statusReason: 401 } } });
    await retryFailedWebhooks();
    expect((await db.select().from(channels))[0].status).toBe("conectado");
    expect(await db.select().from(alerts)).toHaveLength(0);
  });

  it("edição de mensagem atualiza o texto original em vez de criar bolha vazia", async () => {
    await ingestEvolution(up("ORIG", false, text("Quero marcar sexta")));
    await ingestEvolution(up("EDIT1", false, { protocolMessage: { key: { id: "ORIG" }, type: 14, editedMessage: { conversation: "Quero marcar sábado" } } }));
    const ms = await db.select().from(messages);
    expect(ms).toHaveLength(1);
    expect(ms[0].body).toBe("Quero marcar sábado");
    expect(ms[0].editedAt).not.toBeNull();
  });

  it("mensagem apagada pela cliente fica marcada como apagada", async () => {
    await ingestEvolution(up("DEL0", false, text("número errado")));
    await ingestEvolution(up("DEL1", false, { protocolMessage: { key: { id: "DEL0" }, type: 0 } }));
    const ms = await db.select().from(messages);
    expect(ms).toHaveLength(1);
    expect(ms[0].deletedAt).not.toBeNull();
  });

  it("tipos que viravam bolha vazia: lidos certo ou ignorados", () => {
    expect(parseContent({ secretEncryptedMessage: {} } as never)).toBeNull();
    expect(parseContent({ pollUpdateMessage: {} } as never)).toBeNull();
    expect(parseContent({ pinInChatMessage: {} } as never)).toBeNull();
    expect(parseContent({ keepInChatMessage: {} } as never)).toBeNull();
    expect(parseContent({ albumMessage: {} } as never)).toBeNull();
    expect(parseContent({ messageContextInfo: {} } as never)).toBeNull();
    expect(parseContent({ ptvMessage: {} } as never)).toEqual({ kind: "video", body: null });
    expect(parseContent({ viewOnceMessageV2: { message: { imageMessage: { caption: "olha" } } } } as never)).toEqual({ kind: "image", body: "olha" });
    expect(parseContent({ ephemeralMessage: { message: { conversation: "oi" } } } as never)).toEqual({ kind: "text", body: "oi" });
    expect(parseContent({ pollCreationMessageV3: { name: "Melhor dia?" } } as never)).toEqual({ kind: "poll", body: "Enquete: Melhor dia?" });
    expect(parseContent({ buttonsResponseMessage: { selectedDisplayText: "Confirmo" } } as never)).toEqual({ kind: "text", body: "Confirmo" });
    expect(parseContent({ listResponseMessage: { title: "Sábado 10h" } } as never)).toEqual({ kind: "text", body: "Sábado 10h" });
    expect(parseContent({ contactMessage: { displayName: "Bia", vcard: "BEGIN:VCARD\nTEL;type=CELL;waid=5571988887777:+55 71 98888-7777\nEND:VCARD" } } as never))
      .toEqual({ kind: "contact", body: "Bia · +55 71 98888-7777" });
    expect(parseContent({ locationMessage: { degreesLatitude: -12.98, degreesLongitude: -38.5, name: "Casa Fiaes" } } as never))
      .toEqual({ kind: "location", body: "Casa Fiaes · https://maps.google.com/?q=-12.98,-38.5" });
  });

  it("resposta citando outra mensagem guarda o trecho citado", async () => {
    await ingestEvolution(up("Q1", false, { extendedTextMessage: { text: "Esse horário serve", contextInfo: { stanzaId: "X", quotedMessage: { conversation: "Temos sábado às 10h" } } } }));
    expect((await db.select().from(messages))[0].quotedBody).toBe("Temos sábado às 10h");
  });

  it("figurinha logo depois da resposta da Casa não abre espera nem gera alerta", async () => {
    await ingestEvolution(up("S0", false, text("Obrigada!"), new Date(Date.now() - 60_000)));
    await ingestEvolution(up("S1", true, text("Imagina! Até sábado"), new Date(Date.now() - 30_000)));
    await ingestEvolution(up("S2", false, { stickerMessage: {} }));
    expect((await db.select().from(deals))[0].awaitingReplySince).toBeNull();
  });

  it("alerta resolvido pela resposta usa a hora atual (nunca antes de ter sido criado)", async () => {
    await ingestEvolution(up("R0", false, text("oi"), new Date(Date.now() - 20 * 60_000)));
    const [d] = await db.select().from(deals);
    const createdAt = new Date();
    await db.insert(alerts).values({ dealId: d.id, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "x", dedupeKey: "k", createdAt });
    await ingestEvolution(up("R1", true, text("Oi!"), new Date(Date.now() - 15 * 60_000))); // resposta registrada com atraso
    const [a] = await db.select().from(alerts);
    expect(a.resolvedAt!.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });

  it("vigia da conexão: preso reconectando por 5 min vira alerta para a gestão; voltou, volta a conectado", async () => {
    let st: "conectado" | "aguardando_qr" = "aguardando_qr";
    setWhatsappProvider({ createInstance: async () => {}, connect: async () => ({ status: "conectado" }), state: async () => st, logout: async () => {}, remove: async () => {}, sendText: async () => ({ externalId: null }) });
    const t0 = Date.now();
    await checkConnections(new Date(t0));
    expect((await db.select().from(channels))[0].status).toBe("conectado");
    await checkConnections(new Date(t0 + 6 * 60_000));
    expect((await db.select().from(channels))[0].status).toBe("erro");
    const [a] = await db.select().from(alerts);
    expect(a).toMatchObject({ audience: "gestao", type: "whatsapp_sem_conexao", severity: "urgente" });
    st = "conectado";
    await checkConnections(new Date(t0 + 8 * 60_000));
    expect((await db.select().from(channels))[0].status).toBe("conectado");
    expect((await db.select().from(contacts)).length).toBe(0);
  });
});
