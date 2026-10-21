import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, profiles, settings, users } from "../db/schema";
import { recordInbound, recordOutbound } from "./deals";
import { saveDistributionSettings } from "./distribution";
import { offerOverdue } from "./offers";
import { claimDeal } from "./assign";
import { waitKeyOf } from "../rules/wait-key";
import { resetDb } from "../../../test/db";

const MIN = 60_000;
type U = typeof users.$inferSelect;
const allDay: [string, string] = ["00:00", "24:00"];
const mk = async (name: string, o: { availability?: string; profile?: string } = {}) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, o.profile ?? "atendente"));
  return (await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, passwordHash: "x", profileId: p.id,
    availability: o.availability ?? "disponivel", lastSeenAt: new Date() }).returning())[0];
};
const offersOf = (dealId: string) => db.select().from(alerts).where(and(eq(alerts.dealId, dealId), like(alerts.waitKey, "oferta:%")));

describe("oferta quando o prazo estoura", () => {
  let g: U, ana: U, bia: U, carla: U, dealId: string, since: Date;
  beforeEach(async () => {
    await resetDb();
    await db.insert(settings).values({ key: "business_hours", value: { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay } });
    g = (await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0];
    await saveDistributionSettings({ enabled: true, limit: 5 }, g.id);
    ana = await mk("Ana"); bia = await mk("Bia"); carla = await mk("Carla");
    const r = await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71998400001", body: "oi", at: new Date(Date.now() - 10 * MIN) });
    if (!("dealId" in r)) throw new Error();
    dealId = r.dealId;
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, dealId));
    await db.update(dealEvents).set({ createdAt: new Date(Date.now() - 10 * MIN) }).where(eq(dealEvents.dealId, dealId)); // a distribuição foi na chegada
    since = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].awaitingReplySince!;
    // o motor já criou o alerta de atraso da espera (nível 1, para a dona)
    await db.insert(alerts).values({ dealId, userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "x", dedupeKey: "late-1", waitKey: waitKeyOf(dealId, since) });
  });

  it("oferece para a próxima pessoa livre, nunca para a dona", async () => {
    const r = await offerOverdue();
    expect(r.offered).toBe(1);
    const [o] = await offersOf(dealId);
    expect([bia.id, carla.id]).toContain(o.userId);
    expect(o.type).toBe("oferta");
    expect(o.message).toMatch(/^A dona não respondeu\. Pode assumir /);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "oferecido")));
    expect(ev.payload).toMatchObject({ para: o.userId });
  });

  it("rodar de novo dentro do prazo não repete a oferta", async () => {
    await offerOverdue(); await offerOverdue();
    expect(await offersOf(dealId)).toHaveLength(1);
  });

  it("passado mais um prazo sem ninguém assumir, a oferta vai para a seguinte (nunca a mesma pessoa)", async () => {
    await offerOverdue();
    const [first] = await offersOf(dealId);
    await offerOverdue(new Date(Date.now() + 3 * MIN)); // prazo do Lead: 2 min
    const all = await offersOf(dealId);
    expect(all).toHaveLength(2);
    const open = all.filter((o) => !o.resolvedAt);
    expect(open).toHaveLength(1);
    expect(open[0].userId).not.toBe(first.userId);
    expect(open[0].userId).not.toBe(ana.id);
  });

  it("distribuição desligada ou Casa fechada: não oferece", async () => {
    await saveDistributionSettings({ enabled: false, limit: 5 }, g.id);
    expect((await offerOverdue()).offered).toBe(0);
    await saveDistributionSettings({ enabled: true, limit: 5 }, g.id);
    await db.update(settings).set({ value: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } }).where(eq(settings.key, "business_hours"));
    expect((await offerOverdue()).offered).toBe(0);
  });

  it("responder a cliente resolve a oferta aberta", async () => {
    await offerOverdue();
    await recordOutbound({ dealId, channelId: null, body: "Oi!", userId: ana.id });
    expect((await offersOf(dealId)).every((o) => o.resolvedAt)).toBe(true);
  });

  it("assumir pela oferta passa a conversa, avisa a dona anterior e fecha a oferta", async () => {
    await offerOverdue();
    const [o] = await offersOf(dealId);
    await claimDeal(dealId, o.userId!);
    expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].ownerId).toBe(o.userId);
    expect((await offersOf(dealId)).every((x) => x.resolvedAt)).toBe(true);
    const [aviso] = await db.select().from(alerts).where(and(eq(alerts.userId, ana.id), eq(alerts.type, "assumiu_sua_conversa"), isNull(alerts.resolvedAt)));
    expect(aviso.message).toMatch(/assumiu/);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "assumiu")));
    expect(ev.payload).toMatchObject({ porOferta: true });
  });

  it("ninguém livre além da dona: não cria oferta", async () => {
    await db.update(users).set({ availability: "pausa" }).where(eq(users.id, bia.id));
    await db.update(users).set({ availability: "ausente" }).where(eq(users.id, carla.id));
    expect((await offerOverdue()).offered).toBe(0);
  });
});
