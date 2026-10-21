import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { contacts, dealEvents, deals, profiles, settings, stages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { distributionTeam, getDistributionSettings, saveDistributionSettings, setPriorityLevel } from "./distribution";
import { resetDb } from "../../../test/db";

describe("configuração da distribuição", () => {
  beforeEach(resetDb);

  it("nasce desligada, com limite 3", async () => {
    expect(await getDistributionSettings()).toEqual({ enabled: false, limit: 3 });
  });

  it("salva e lê; o limite fica entre 1 e 20", async () => {
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    await saveDistributionSettings({ enabled: true, limit: 5 }, g.id);
    expect(await getDistributionSettings()).toEqual({ enabled: true, limit: 5 });
    await expect(saveDistributionSettings({ enabled: true, limit: 0 }, g.id)).rejects.toThrow();
    await expect(saveDistributionSettings({ enabled: true, limit: 21 }, g.id)).rejects.toThrow();
  });

  it("valor estranho gravado no banco cai no padrão seguro", async () => {
    await db.insert(settings).values({ key: "distribuicao", value: { enabled: "sim", limit: 999 } });
    expect(await getDistributionSettings()).toEqual({ enabled: false, limit: 3 });
  });
});

describe("entrega da conversa nova (distribuição ligada)", () => {
  type U = typeof users.$inferSelect;
  let g: U;
  const mk = async (name: string, o: { level?: number; availability?: string; seenMinAgo?: number | null; profile?: string } = {}) => {
    const [p] = await db.select().from(profiles).where(eq(profiles.key, o.profile ?? "atendente"));
    const seen = o.seenMinAgo === null ? null : new Date(Date.now() - (o.seenMinAgo ?? 0) * 60_000);
    return (await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, passwordHash: "x", profileId: p.id,
      priorityLevel: o.level ?? 1, availability: o.availability ?? "disponivel", lastSeenAt: seen }).returning())[0];
  };
  let n = 0;
  const inbound = async () => {
    const r = await recordInbound({ channelId: null, externalId: `D${++n}`, phoneRaw: `71998${String(100000 + n)}`, body: "oi" });
    if (!("dealId" in r)) throw new Error("sem lead");
    return (await db.select().from(deals).where(eq(deals.id, r.dealId)))[0];
  };
  const waitingFor = async (userId: string, k: number) => {
    for (let i = 0; i < k; i++) {
      const d = await inbound();
      await db.update(deals).set({ ownerId: userId, awaitingReplySince: new Date() }).where(eq(deals.id, d.id));
    }
  };

  beforeEach(async () => {
    await resetDb();
    g = (await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0];
    await saveDistributionSettings({ enabled: true, limit: 2 }, g.id);
  });

  it("desligada: segue a regra antiga (atendente com menos leads)", async () => {
    await saveDistributionSettings({ enabled: false, limit: 2 }, g.id);
    const ana = await mk("Ana", { availability: "ausente", seenMinAgo: null });
    expect((await inbound()).ownerId).toBe(ana.id);
  });

  it("nível 1 recebe antes do nível 2; no mesmo nível, quem tem menos esperando", async () => {
    const ana = await mk("Ana"), bia = await mk("Bia"), carla = await mk("Carla", { level: 2 });
    await waitingFor(ana.id, 1);
    expect((await inbound()).ownerId).toBe(bia.id);
    expect([ana.id, bia.id]).toContain((await inbound()).ownerId);
    void carla;
  });

  it("nível 2 só recebe quando o nível 1 está cheio", async () => {
    const ana = await mk("Ana"), carla = await mk("Carla", { level: 2 });
    await waitingFor(ana.id, 2); // limite 2
    expect((await inbound()).ownerId).toBe(carla.id);
  });

  it("ausente, em pausa ou sem sinal há mais de 5 min não recebe; ninguém livre: fica sem dona", async () => {
    await mk("Ana", { availability: "ausente" });
    await mk("Bia", { availability: "pausa" });
    await mk("Carla", { seenMinAgo: 6 });
    expect((await inbound()).ownerId).toBeNull();
  });

  it("perfil sem 'Receber leads da distribuição' não recebe (a gestão padrão, por exemplo)", async () => {
    await db.update(users).set({ availability: "disponivel", lastSeenAt: new Date() }).where(eq(users.id, g.id));
    expect((await inbound()).ownerId).toBeNull();
  });

  it("cliente que volta cai com quem a atendeu da última vez, se ela estiver livre", async () => {
    const ana = await mk("Ana"), bia = await mk("Bia");
    const first = await inbound();
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    await db.update(deals).set({ ownerId: bia.id, stageId: fechado.id, closedAt: new Date() }).where(eq(deals.id, first.id));
    await waitingFor(bia.id, 1); // Bia tem mais carga que a Ana, mas a cliente é dela
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, first.contactId));
    const r = await recordInbound({ channelId: null, externalId: "VOLTA", phoneRaw: ct.phoneE164, body: "oi de novo" });
    if (!("dealId" in r)) throw new Error();
    expect((await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].ownerId).toBe(bia.id);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, r.dealId), eq(dealEvents.type, "distribuido")));
    expect(ev.payload).toMatchObject({ para: bia.id, motivo: "retorno" });
    void ana;
  });

  it("grava quando cada pessoa recebeu por último (desempate do rodízio)", async () => {
    const ana = await mk("Ana");
    await inbound();
    expect((await db.select().from(users).where(eq(users.id, ana.id)))[0].lastAssignedAt).not.toBeNull();
  });

  it("duas conversas ao mesmo tempo e uma vaga só: uma vai para a pessoa, a outra fica sem dona", async () => {
    await saveDistributionSettings({ enabled: true, limit: 1 }, g.id);
    const ana = await mk("Ana");
    const [a, b] = await Promise.all([
      recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71998200001", body: "oi" }),
      recordInbound({ channelId: null, externalId: "C2", phoneRaw: "71998200002", body: "oi" }),
    ]);
    if (!("dealId" in a) || !("dealId" in b)) throw new Error();
    const owners = (await db.select().from(deals).where(inArray(deals.id, [a.dealId, b.dealId]))).map((d) => d.ownerId);
    expect(owners.filter((o) => o === ana.id)).toHaveLength(1);
    expect(owners.filter((o) => o === null)).toHaveLength(1);
  });
});

describe("equipe na distribuição", () => {
  beforeEach(resetDb);
  it("lista só quem recebe leads, com estado, nível e quantas esperam; o nível vai de 1 a 3", async () => {
    const [g] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x", availability: "disponivel", lastSeenAt: new Date() }).returning();
    await setPriorityLevel(ana.id, 2, g.id);
    const team = await distributionTeam();
    expect(team.map((t) => t.name)).toEqual(["Ana"]);
    expect(team[0]).toMatchObject({ availability: "disponivel", online: true, priorityLevel: 2, waiting: 0 });
    await expect(setPriorityLevel(ana.id, 4, g.id)).rejects.toThrow();
  });
});
