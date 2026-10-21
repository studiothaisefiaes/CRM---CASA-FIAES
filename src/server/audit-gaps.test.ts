import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { alerts, channels, contacts, deals, messages, users } from "./db/schema";
import { recordInbound, recordOutbound, moveDeal, ReopenConflict } from "./domain/deals";
import { ingestEvolution } from "./whatsapp/webhook";
import { sendFromCrm } from "./domain/send";
import { setWhatsappProvider } from "./whatsapp/evolution";
import { resetDb } from "../../test/db";

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
});

describe("lacunas da auditoria", () => {
  it("@lid com número alternativo vira lead normalmente", async () => {
    await ingestEvolution({ event: "messages.upsert", instance: "casa-principal", data: {
      key: { remoteJid: "12345678901234@lid", remoteJidAlt: "5571999812244@s.whatsapp.net", fromMe: false, id: "LID1" },
      pushName: "Mariana", message: { conversation: "oi" }, messageTimestamp: 1791550931 } });
    expect((await db.select().from(deals)).length).toBe(1);
  });

  it("@lid sem número não some: vira lead com 'Número oculto' (pedido 14/10; antes só avisava a gestão)", async () => {
    const r = await ingestEvolution({ event: "messages.upsert", instance: "casa-principal", data: {
      key: { remoteJid: "12345678901234@lid", fromMe: false, id: "LID2" }, pushName: "Desconhecida", message: { conversation: "oi" } } });
    expect(r).toMatchObject({ ok: true, kind: "in" });
    const [c] = await db.select().from(contacts).where(eq(contacts.waLid, "12345678901234"));
    expect(c).toMatchObject({ phoneE164: "lid:12345678901234", name: "Desconhecida" });
    expect(await db.select().from(deals).where(eq(deals.contactId, c.id))).toHaveLength(1);
  });

  it("nunca dois leads abertos: reabrir com outro aberto é recusado", async () => {
    const r1 = await recordInbound({ channelId: null, externalId: "a", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r1)) throw new Error();
    await moveDeal(r1.dealId, "perdido", null);
    await recordInbound({ channelId: null, externalId: "b", phoneRaw: "71999812244", body: "voltei" });
    await expect(moveDeal(r1.dealId, "atendimento", null)).rejects.toBeInstanceOf(ReopenConflict);
    expect((await db.select().from(deals)).filter((d) => !d.closedAt).length).toBe(1);
  });

  it("mensagem antiga reprocessada depois da resposta não reabre a espera", async () => {
    const t0 = new Date("2026-10-13T13:00:00Z");
    const r = await recordInbound({ channelId: null, externalId: "m1", phoneRaw: "71999812244", body: "oi", at: t0 });
    if (!("dealId" in r)) throw new Error();
    await recordOutbound({ dealId: r.dealId, channelId: null, body: "olá", at: new Date(t0.getTime() + 60_000) });
    await recordInbound({ channelId: null, externalId: "m0", phoneRaw: "71999812244", body: "mensagem atrasada", at: new Date(t0.getTime() - 30_000) });
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.awaitingReplySince).toBeNull();
    expect(d.lastInboundAt?.toISOString()).toBe(t0.toISOString());
  });

  it("envio pelo CRM: grava quem enviou mesmo se o webhook chegar antes da resposta da Evolution", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    const r = await recordInbound({ channelId: null, externalId: "m1", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    setWhatsappProvider({
      createInstance: async () => {}, connect: async () => ({ status: "conectado" }), state: async () => "conectado", logout: async () => {}, remove: async () => {},
      sendText: async (_i, _to, text) => {
        // a Evolution dispara o webhook send.message antes de responder ao envio
        await ingestEvolution({ event: "send.message", instance: "casa-principal", data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: true, id: "EXT1" }, message: { conversation: text } } });
        return { externalId: "EXT1" };
      },
    });
    await sendFromCrm(r.dealId, "Olá, Mariana!", ana.id);
    setWhatsappProvider(null);
    const out = (await db.select().from(messages)).filter((m) => m.direction === "out");
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ externalId: "EXT1", sentByUserId: ana.id, status: "sent" });
  });

  it("falha no envio deixa a mensagem como 'failed' e o lead continua esperando", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    const r = await recordInbound({ channelId: null, externalId: "m1", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    setWhatsappProvider({ createInstance: async () => {}, connect: async () => ({ status: "conectado" }), state: async () => "conectado", logout: async () => {}, remove: async () => {},
      sendText: async () => { throw new Error("timeout"); } });
    await expect(sendFromCrm(r.dealId, "Olá", ana.id)).rejects.toThrow(/Não foi possível enviar/);
    setWhatsappProvider(null);
    const out = (await db.select().from(messages)).find((m) => m.direction === "out")!;
    expect(out.status).toBe("failed");
    expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
  });

  it("status de entrega só avança (enviada → entregue → lida)", async () => {
    const r = await recordInbound({ channelId: null, externalId: "m1", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await recordOutbound({ dealId: r.dealId, channelId: null, externalId: "X9", body: "olá" });
    const upd = (status: string) => ingestEvolution({ event: "messages.update", instance: "casa-principal", data: { keyId: "X9", status } });
    await upd("READ");
    await upd("DELIVERY_ACK");
    const out = (await db.select().from(messages)).find((m) => m.externalId === "X9")!;
    expect(out.status).toBe("read");
  });

  it("número que cai avisa a gestão", async () => {
    await ingestEvolution({ event: "connection.update", instance: "casa-principal", data: { state: "close" } });
    const [a] = await db.select().from(alerts);
    expect(a).toMatchObject({ audience: "gestao", type: "whatsapp_desconectado", severity: "urgente" });
  });
});
