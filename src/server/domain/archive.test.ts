import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, messages, contacts, users, channels, alerts, dealEvents, stages } from "../db/schema";
import { recordInbound, ignoreContact, unignoreContact, importHistoryChat, moveDeal } from "./deals";
import { archiveDeals, restoreDeals } from "./archive";
import { startQuiet, endQuiet, isQuiet } from "./quiet";
import { createManualLead } from "./updates";
import { runRules } from "../rules/engine";
import { ingestEvolution } from "../whatsapp/webhook";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { channelState } from "./config";
import { resetDb } from "../../../test/db";

let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "T", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});
afterEach(() => setWhatsappProvider(null));

describe("arquivar (não é cliente)", () => {
  it("arquiva sem apagar e Desfazer restaura etapa e mensagens", async () => {
    const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71999990001", body: "oi primo" });
    if (!("dealId" in r)) throw new Error();
    await archiveDeals([r.dealId], uid);
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.archivedAt).not.toBeNull();
    expect(d.archivedBy).toBe(uid);
    expect(d.archivedStageId).toBe(d.stageId);
    expect((await db.select().from(contacts))[0].ignored).toBe(true);
    expect((await db.select().from(messages)).every((m) => m.dealId === r.dealId)).toBe(true);
    await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71999990001", body: "e aí" }); // Review Focus 1
    await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71999990001", body: "e aí" }); // mesmo webhook 2x
    expect((await db.select().from(deals)).length).toBe(1);
    expect((await db.select().from(messages)).length).toBe(2);
    expect((await db.select().from(messages)).every((m) => m.dealId === r.dealId)).toBe(true);
    expect(await db.select().from(alerts)).toHaveLength(0);
    const res = await restoreDeals([r.dealId], uid);
    expect(res).toEqual({ restored: 1, conflicts: [] });
    const [back] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(back.archivedAt).toBeNull();
    expect(back.archivedBy).toBeNull();
    expect(back.archivedStageId).toBeNull();
    expect(back.stageId).toBe(d.stageId);
    expect(back.ownerId).toBe(d.ownerId);
    expect(back.ownerId).not.toBeNull();
    expect((await db.select().from(contacts))[0].ignored).toBe(false);
    expect((await db.select().from(messages)).length).toBe(2);
    const types = (await db.select().from(dealEvents).where(eq(dealEvents.dealId, r.dealId))).map((e) => e.type);
    expect(types).toContain("arquivado");
    expect(types).toContain("restaurado");
  });

  it("em massa", async () => {
    const ids: string[] = [];
    for (const p of ["71999990002", "71999990003", "71999990004"]) {
      const r = await recordInbound({ channelId: null, externalId: p, phoneRaw: p, body: "oi" });
      if ("dealId" in r) ids.push(r.dealId);
    }
    expect(await archiveDeals(ids, uid)).toMatchObject({ archived: 3 });
    expect(await archiveDeals(ids, uid)).toMatchObject({ archived: 0 }); // já arquivados: não conta de novo
    expect(await db.select().from(deals)).toHaveLength(3);
  });

  it("restaurar com outro lead aberto do mesmo contato vira conflito e o arquivado continua arquivado", async () => {
    const r = await recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71999990010", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    const a = r.dealId;
    await archiveDeals([a], uid);
    const b = await createManualLead({ phone: "71999990010", name: "Cliente" }, uid);
    expect(b).not.toBe(a);
    expect(await restoreDeals([a], uid)).toEqual({ restored: 0, conflicts: [a] });
    const [still] = await db.select().from(deals).where(eq(deals.id, a));
    expect(still.archivedAt).not.toBeNull();
  });

  it("arquivar resolve os alertas abertos do lead", async () => {
    const r = await recordInbound({ channelId: null, externalId: "AL1", phoneRaw: "71999990013", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await db.insert(alerts).values({ dealId: r.dealId, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "x", dedupeKey: "al1" });
    await archiveDeals([r.dealId], uid);
    expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
  });

  it("arquivar lead antigo (fechado) não marca 'não é cliente' se o contato tem outro lead em andamento", async () => {
    const r1 = await recordInbound({ channelId: null, externalId: "F1", phoneRaw: "71999990014", body: "oi" });
    if (!("dealId" in r1)) throw new Error();
    await moveDeal(r1.dealId, "perdido", uid);
    const r2 = await recordInbound({ channelId: null, externalId: "F2", phoneRaw: "71999990014", body: "voltei" });
    if (!("dealId" in r2)) throw new Error();
    expect(r2.dealId).not.toBe(r1.dealId);
    expect(await archiveDeals([r1.dealId], uid)).toMatchObject({ archived: 1 });
    expect((await db.select().from(contacts))[0].ignored).toBe(false);
  });

  it("lead arquivado esperando resposta não gera alerta no motor", async () => {
    const t0 = new Date("2026-10-13T13:00:00Z");
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999990011", body: "oi", at: t0 });
    if (!("dealId" in r)) throw new Error();
    await archiveDeals([r.dealId], uid);
    await runRules(new Date(t0.getTime() + 60 * 60_000));
    expect(await db.select().from(alerts)).toHaveLength(0);
  });

  it("ignoreContact arquiva (não apaga) e unignoreContact restaura", async () => {
    const r = await recordInbound({ channelId: null, externalId: "I1", phoneRaw: "71999990012", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    const { contactId } = await ignoreContact(r.dealId, uid);
    expect(await db.select().from(deals)).toHaveLength(1);
    expect((await db.select().from(deals))[0].archivedAt).not.toBeNull();
    await unignoreContact(contactId, uid);
    expect((await db.select().from(deals))[0].archivedAt).toBeNull();
    expect((await db.select().from(contacts))[0].ignored).toBe(false);
  });
});

describe("modo quieto", () => {
  it("canal em modo quieto não gera alerta; depois de quiet_until gera", async () => { // Review Focus 2
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado" }).returning();
    const t0 = new Date("2026-10-13T13:00:00Z");
    await startQuiet(ch.id, 48, t0);
    expect(await isQuiet(ch.id, t0)).toBe(true);
    expect(await isQuiet(ch.id, new Date(t0.getTime() + 49 * 3_600_000))).toBe(false);
    expect(await isQuiet(null, t0)).toBe(false);
    await recordInbound({ channelId: ch.id, externalId: "Q1", phoneRaw: "71999990005", body: "oi", at: t0 });
    await runRules(new Date(t0.getTime() + 30 * 60_000));
    expect(await db.select().from(alerts)).toHaveLength(0);
    await db.update(channels).set({ quietUntil: new Date(t0.getTime() - 1) });
    await runRules(new Date(t0.getTime() + 31 * 60_000));
    expect((await db.select().from(alerts)).length).toBeGreaterThan(0);
  });

  it("endQuiet encerra o modo quieto na hora", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado" }).returning();
    await startQuiet(ch.id);
    expect(await isQuiet(ch.id, new Date())).toBe(true);
    await endQuiet(ch.id);
    expect(await isQuiet(ch.id, new Date())).toBe(false);
  });

  it("fronteira: em quiet_until exato o canal já não está quieto, no motor e no isQuiet", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado" }).returning();
    const t0 = new Date("2026-10-13T13:00:00Z");
    await recordInbound({ channelId: ch.id, externalId: "B1", phoneRaw: "71999990015", body: "oi", at: t0 });
    const t = new Date(t0.getTime() + 30 * 60_000);
    await db.update(channels).set({ quietUntil: t });
    expect(await isQuiet(ch.id, t)).toBe(false);
    await runRules(t);
    expect((await db.select().from(alerts)).length).toBeGreaterThan(0);
  });

  it("histórico importado com o canal quieto não abre espera", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado" }).returning();
    const now = new Date("2026-10-13T13:00:00Z");
    await startQuiet(ch.id, 48, new Date(now.getTime() - 60_000));
    await importHistoryChat(ch.id, "71999990016", [{ externalId: "H1", fromMe: false, at: new Date(now.getTime() - 30 * 60_000), kind: "text", body: "oi" }], now);
    const [d] = await db.select().from(deals);
    expect(d).toBeDefined();
    expect(d.awaitingReplySince).toBeNull();
  });
});

describe("gatilho do modo quieto", () => {
  const open = (wuid = "557199990404@s.whatsapp.net") => ingestEvolution({ event: "connection.update", instance: "rec", data: { state: "open", wuid }, date_time: String(Math.random()) });
  const quietOf = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0].quietUntil;

  it("primeiro pareamento (canal sem número) liga 48 h", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "aguardando_qr" }).returning();
    const before = Date.now();
    await open();
    const ms = (await quietOf(ch.id))!.getTime() - before;
    expect(ms).toBeGreaterThan(47.9 * 3_600_000);
    expect(ms).toBeLessThan(48.1 * 3_600_000);
  });

  it("queda de rede (desconectado → open, mesmo número, sem QR recente) não liga", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "desconectado", phone: "+557199990404",
      lastQrAt: new Date(Date.now() - 3 * 86_400_000) }).returning();
    await open();
    expect((await db.select().from(channels).where(eq(channels.id, ch.id)))[0].status).toBe("conectado");
    expect(await quietOf(ch.id)).toBeNull();
  });

  it("logout → QR lido → open com o mesmo número liga", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "desconectado", phone: "+557199990404" }).returning();
    await ingestEvolution({ event: "qrcode.updated", instance: "rec", data: {}, date_time: "qr1" });
    await open();
    expect(await quietOf(ch.id)).not.toBeNull();
  });

  it("outro número lido no canal liga", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
    await open("557199990000@s.whatsapp.net");
    expect(await quietOf(ch.id)).not.toBeNull();
  });

  it("consulta de status chega antes do webhook: liga uma vez só (não estende)", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "aguardando_qr", phone: "+557199990404", lastQrAt: new Date() }).returning();
    setWhatsappProvider({ createInstance: async () => {}, connect: async () => ({ status: "conectado" }), state: async () => "conectado", logout: async () => {}, remove: async () => {},
      sendText: async () => { throw new Error("sem envio em teste"); } });
    expect(await channelState(ch.id)).toBe("conectado");
    const first = await quietOf(ch.id);
    expect(first).not.toBeNull();
    await open();
    expect((await quietOf(ch.id))!.getTime()).toBe(first!.getTime());
  });
});
