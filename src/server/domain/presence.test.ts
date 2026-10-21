import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, profiles, users } from "../db/schema";
import { recordInbound, recordOutbound } from "./deals";
import { saveDistributionSettings } from "./distribution";
import { beat, setAvailability, sweepPresence } from "./presence";
import { resetDb } from "../../../test/db";

type U = typeof users.$inferSelect;
const MIN = 60_000;
const get = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const mk = async (name: string, o: { availability?: string; seenMinAgo?: number; availabilityAt?: Date; profile?: string } = {}) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, o.profile ?? "atendente"));
  return (await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, passwordHash: "x", profileId: p.id,
    availability: o.availability ?? "disponivel", availabilityAt: o.availabilityAt ?? null,
    lastSeenAt: o.seenMinAgo == null ? null : new Date(Date.now() - o.seenMinAgo * MIN) }).returning())[0];
};

describe("presença", () => {
  let g: U;
  beforeEach(async () => {
    await resetDb();
    g = (await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0];
  });

  it("abrir o CRM (batida) deixa disponível quem recebe leads e estava ausente", async () => {
    const ana = await mk("Ana", { availability: "ausente" });
    await beat(ana.id);
    const a = await get(ana.id);
    expect(a.availability).toBe("disponivel");
    expect(a.lastSeenAt).not.toBeNull();
  });

  it("a batida devolve o estado resultante (a tela já abre com ele)", async () => {
    const ana = await mk("Ana", { availability: "ausente" });
    expect(await beat(ana.id)).toBe("disponivel");
    expect(await beat(g.id)).toBe("ausente");
  });

  it("a batida não liga quem não recebe leads (gestão padrão): só marca o sinal", async () => {
    await beat(g.id);
    const x = await get(g.id);
    expect(x.availability).toBe("ausente");
    expect(x.lastSeenAt).not.toBeNull();
  });

  it("pausa de hoje continua pausa; pausa de ontem volta a disponível", async () => {
    const hoje = await mk("Hoje", { availability: "pausa", availabilityAt: new Date() });
    const ontem = await mk("Ontem", { availability: "pausa", availabilityAt: new Date(Date.now() - 30 * 3600_000) });
    await beat(hoje.id); await beat(ontem.id);
    expect((await get(hoje.id)).availability).toBe("pausa");
    expect((await get(ontem.id)).availability).toBe("disponivel");
  });

  it("varredura: sem sinal há mais de 5 min vira ausente; com 4 min continua", async () => {
    const a = await mk("Ana", { seenMinAgo: 6 }), b = await mk("Bia", { seenMinAgo: 4 });
    const r = await sweepPresence();
    expect(r.away).toBe(1);
    expect((await get(a.id)).availability).toBe("ausente");
    expect((await get(b.id)).availability).toBe("disponivel");
  });

  it("pausa e ausência devolvem só os leads sem resposta: com a distribuição ligada vão para quem está livre", async () => {
    await saveDistributionSettings({ enabled: true, limit: 3 }, g.id);
    const ana = await mk("Ana", { seenMinAgo: 0 }), bia = await mk("Bia", { seenMinAgo: 0 });
    const r1 = await recordInbound({ channelId: null, externalId: "P1", phoneRaw: "71998300001", body: "oi" });
    const r2 = await recordInbound({ channelId: null, externalId: "P2", phoneRaw: "71998300002", body: "oi" });
    if (!("dealId" in r1) || !("dealId" in r2)) throw new Error();
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r1.dealId));
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r2.dealId));
    await recordOutbound({ dealId: r2.dealId, channelId: null, body: "Oi! Já te respondo", userId: ana.id }); // r2 já foi respondido
    const out = await setAvailability(ana.id, "pausa");
    expect(out.returned).toBe(1);
    expect((await db.select().from(deals).where(eq(deals.id, r1.dealId)))[0].ownerId).toBe(bia.id);
    expect((await db.select().from(deals).where(eq(deals.id, r2.dealId)))[0].ownerId).toBe(ana.id);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, r1.dealId), eq(dealEvents.type, "devolvido_a_fila")));
    expect(ev.payload).toMatchObject({ de: ana.id, motivo: "pausa" });
  });

  it("com a distribuição desligada, pausa não mexe nos leads", async () => {
    const ana = await mk("Ana", { seenMinAgo: 0 });
    const r = await recordInbound({ channelId: null, externalId: "Q1", phoneRaw: "71998300003", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r.dealId));
    expect((await setAvailability(ana.id, "pausa")).returned).toBe(0);
    expect((await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].ownerId).toBe(ana.id);
  });

  it("ninguém livre: o lead devolvido fica sem dona", async () => {
    await saveDistributionSettings({ enabled: true, limit: 3 }, g.id);
    const ana = await mk("Ana", { seenMinAgo: 0 });
    const r = await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71998300004", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r.dealId));
    await setAvailability(ana.id, "ausente");
    expect((await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].ownerId).toBeNull();
  });

  it("varredura também devolve os leads de quem sumiu", async () => {
    await saveDistributionSettings({ enabled: true, limit: 3 }, g.id);
    const ana = await mk("Ana", { seenMinAgo: 9 });
    const r = await recordInbound({ channelId: null, externalId: "T1", phoneRaw: "71998300005", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r.dealId));
    expect((await sweepPresence()).returned).toBe(1);
    expect((await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].ownerId).toBeNull();
  });
});
