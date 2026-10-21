import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { stages, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals";
import { teamPerformance } from "./team";
import { resetDb } from "../../../test/db";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 6, h + 3, m)); // 06/10/2026 (terça), hora de Salvador

describe("desempenho por atendente (PDF da equipe)", () => {
  let ana: string, bia: string;
  beforeEach(async () => {
    await resetDb();
    [{ id: ana }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    [{ id: bia }] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  });

  it("por pessoa, em ordem alfabética: recebidas, respondidas no prazo, agendamentos e vendas; valor só com money", async () => {
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    for (const [i, owner] of [[1, ana], [2, ana], [3, bia]] as const) {
      const r = await recordInbound({ channelId: null, externalId: `T${i}`, phoneRaw: `7199880000${i}`, body: "oi", at: T(10, i) });
      if (!("dealId" in r)) throw new Error();
      const { deals } = await import("../db/schema");
      await db.update(deals).set({ ownerId: owner }).where(eq(deals.id, r.dealId));
      await recordOutbound({ dealId: r.dealId, channelId: null, body: "oi!", userId: owner, at: T(10, i + 1) });
      if (i === 1) await db.update(deals).set({ stageId: fechado.id, closedAt: T(12), valueCents: 30_000 }).where(eq(deals.id, r.dealId));
    }
    const rows = await teamPerformance({ period: "hoje", now: T(18) }, { money: true });
    expect(rows.map((r) => r.name)).toEqual(["Ana", "Bia"]);
    const a = rows[0];
    expect(a).toMatchObject({ received: 2, answered: 2, sales: 1, salesCents: 30_000 });
    expect(a.smallSample).toBe(true); // menos de 20 respostas: base pequena marcada
    expect((await teamPerformance({ period: "hoje", now: T(18) }, { money: false }))[0].salesCents).toBeNull();
    expect((await teamPerformance({ period: "hoje", now: T(18), ownerId: bia }, { money: true })).map((r) => r.name)).toEqual(["Bia"]);
  });

  it("venda de contato marcado como 'não é cliente' não conta (igual ao total do período); conversão = vendas / leads novos", async () => {
    const { deals, contacts } = await import("../db/schema");
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    const r = await recordInbound({ channelId: null, externalId: "IG1", phoneRaw: "71998800009", body: "oi", at: T(10) });
    if (!("dealId" in r)) throw new Error();
    await db.update(deals).set({ ownerId: ana, stageId: fechado.id, closedAt: T(12), valueCents: 10_000 }).where(eq(deals.id, r.dealId));
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, d.contactId));
    const rows = await teamPerformance({ period: "hoje", now: T(18) }, { money: true });
    expect(rows.find((x) => x.name === "Ana")?.sales ?? 0).toBe(0);
  });
});
