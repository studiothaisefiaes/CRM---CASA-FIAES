import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, messages, contacts, users, channels, alerts, dealEvents } from "../db/schema";
import { recordInbound, ignoreContact, unignoreContact } from "./deals";
import { archiveDeals, restoreDeals } from "./archive";
import { startQuiet, endQuiet, isQuiet } from "./quiet";
import { createManualLead } from "./updates";
import { runRules } from "../rules/engine";
import { ingestEvolution } from "../whatsapp/webhook";
import { resetDb } from "../../../test/db";

let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "T", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});

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
    expect((await db.select().from(deals)).length).toBe(1);
    expect((await db.select().from(messages)).every((m) => m.dealId === r.dealId)).toBe(true);
    expect(await db.select().from(alerts)).toHaveLength(0);
    const res = await restoreDeals([r.dealId], uid);
    expect(res).toEqual({ restored: 1, conflicts: [] });
    const [back] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(back.archivedAt).toBeNull();
    expect(back.archivedBy).toBeNull();
    expect(back.archivedStageId).toBeNull();
    expect(back.stageId).toBe(d.stageId);
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
    expect(await archiveDeals(ids, uid)).toEqual({ archived: 3 });
    expect(await archiveDeals(ids, uid)).toEqual({ archived: 0 }); // já arquivados: não conta de novo
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

  it("parear o número liga o modo quieto de 48 h; reconexão do mesmo número não renova", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "aguardando_qr" }).returning();
    const before = Date.now();
    await ingestEvolution({ event: "connection.update", instance: "rec", data: { state: "open", wuid: "557199990404@s.whatsapp.net" } });
    const [after] = await db.select().from(channels).where(eq(channels.id, ch.id));
    expect(after.status).toBe("conectado");
    const ms = after.quietUntil!.getTime() - before;
    expect(ms).toBeGreaterThan(47.9 * 3_600_000);
    expect(ms).toBeLessThan(48.1 * 3_600_000);
    await db.update(channels).set({ quietUntil: null }).where(eq(channels.id, ch.id));
    await ingestEvolution({ event: "connection.update", instance: "rec", data: { state: "open", wuid: "557199990404@s.whatsapp.net" } });
    expect((await db.select().from(channels).where(eq(channels.id, ch.id)))[0].quietUntil).toBeNull();
    // Outro número lido no mesmo canal: histórico novo chegando, liga de novo.
    await ingestEvolution({ event: "connection.update", instance: "rec", data: { state: "open", wuid: "557199990000@s.whatsapp.net" } });
    expect((await db.select().from(channels).where(eq(channels.id, ch.id)))[0].quietUntil).not.toBeNull();
  });
});
