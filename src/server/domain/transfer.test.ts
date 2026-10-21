import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, profiles, users } from "../db/schema";
import { recordInbound } from "./deals";
import { transferDeal } from "./assign";
import { getDealDetail } from "../queries/deal";
import { resetDb } from "../../../test/db";

describe("transferir", () => {
  let ana: typeof users.$inferSelect, bia: typeof users.$inferSelect, dealId: string;
  beforeEach(async () => {
    await resetDb();
    [ana] = await db.insert(users).values({ name: "Ana Souza", email: "a@c.com", role: "atendente", passwordHash: "x", availability: "disponivel", priorityLevel: 1 }).returning();
    [bia] = await db.insert(users).values({ name: "Bia Lima", email: "b@c.com", role: "atendente", passwordHash: "x", availability: "pausa", priorityLevel: 2 }).returning();
    const r = await recordInbound({ channelId: null, externalId: "T1", phoneRaw: "71998500001", pushName: "Fulana", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    dealId = r.dealId;
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, dealId));
  });

  it("passa o lead e avisa quem recebe", async () => {
    await transferDeal(dealId, bia.id, ana.id);
    expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].ownerId).toBe(bia.id);
    const [a] = await db.select().from(alerts).where(and(eq(alerts.userId, bia.id), eq(alerts.type, "transferido_para_voce"), isNull(alerts.resolvedAt)));
    expect(a.message).toBe("Ana te passou a conversa de Fulana");
  });

  it("transferir para si mesma não cria aviso", async () => {
    await transferDeal(dealId, ana.id, ana.id);
    expect(await db.select().from(alerts).where(eq(alerts.type, "transferido_para_voce"))).toHaveLength(0);
  });

  it("pessoa desativada não recebe", async () => {
    await db.update(users).set({ active: false }).where(eq(users.id, bia.id));
    await expect(transferDeal(dealId, bia.id, ana.id)).rejects.toThrow("não está mais na equipe");
  });

  it("a lista de quem pode receber mostra estado, nível e quantas esperam resposta", async () => {
    const d = (await getDealDetail(dealId))!;
    expect(d.people.find((p) => p.id === ana.id)).toMatchObject({ availability: "disponivel", priorityLevel: 1, waiting: 1 });
    expect(d.people.find((p) => p.id === bia.id)).toMatchObject({ availability: "pausa", priorityLevel: 2, waiting: 0 });
  });
  it("a profissional (só o app /pro) não aparece no Passar para e não recebe conversa", async () => {
    const [prof] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "profissional"));
    const [lia] = await db.insert(users).values({ name: "Lia Prof", email: "l@c.com", role: "atendente", passwordHash: "x", profileId: prof.id }).returning();
    const d = (await getDealDetail(dealId))!;
    expect(d.people.map((p) => p.id)).not.toContain(lia.id);
    expect(d.people.map((p) => p.id)).toContain(bia.id);
    await expect(transferDeal(dealId, lia.id, ana.id)).rejects.toThrow("não abre as Conversas");
  });
});
