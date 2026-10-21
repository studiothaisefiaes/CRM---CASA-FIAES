import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull, like, notLike } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, profiles, sessions, settings, users } from "../db/schema";
import { recordInbound } from "./deals";
import { saveDistributionSettings } from "./distribution";
import { beat, beatForToken, setAvailability, sweepPresence } from "./presence";
import { assignWaitingUnowned, offerOverdue } from "./offers";
import { claimDeal, transferDeal } from "./assign";
import { insertSession } from "../auth/sessions-store";
import { waitKeyOf } from "../rules/wait-key";
import { resetDb } from "../../../test/db";

const MIN = 60_000;
type U = typeof users.$inferSelect;
const allDay: [string, string] = ["00:00", "24:00"];
const get = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const mk = async (name: string, availability = "disponivel") => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
  return (await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, passwordHash: "x", profileId: p.id, availability, lastSeenAt: new Date() }).returning())[0];
};
const waitAlert = (dealId: string) => db.select().from(alerts)
  .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt), notLike(alerts.waitKey, "oferta:%"), notLike(alerts.waitKey, "task:%")));

describe("correções da revisão da distribuição", () => {
  let g: U;
  beforeEach(async () => {
    await resetDb();
    await db.insert(settings).values({ key: "business_hours", value: { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay } });
    g = (await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0];
    await saveDistributionSettings({ enabled: true, limit: 5 }, g.id);
  });

  it("Ausente escolhido pela própria pessoa vale o dia: a batida não desfaz", async () => {
    const ana = await mk("Ana");
    await setAvailability(ana.id, "ausente");
    await beat(ana.id);
    expect((await get(ana.id)).availability).toBe("ausente");
  });

  it("ausente automático (sumiu ou saiu) volta a disponível ao abrir o CRM", async () => {
    const ana = await mk("Ana");
    await db.update(users).set({ lastSeenAt: new Date(Date.now() - 9 * MIN) }).where(eq(users.id, ana.id));
    await sweepPresence();
    expect((await get(ana.id)).availability).toBe("ausente");
    await beat(ana.id);
    expect((await get(ana.id)).availability).toBe("disponivel");
  });

  it("depois de sair (sessão apagada), a aba que ficou aberta não liga mais a pessoa", async () => {
    const ana = await mk("Ana");
    const { token } = await insertSession(ana.id);
    expect(await beatForToken(token)).toBe(true);
    await db.delete(sessions).where(eq(sessions.userId, ana.id));
    await setAvailability(ana.id, "ausente", new Date(), { manual: false });
    expect(await beatForToken(token)).toBe(false);
    expect((await get(ana.id)).availability).toBe("ausente");
  });

  describe("prazo estourado", () => {
    let ana: U, bia: U, carla: U, dealId: string;
    beforeEach(async () => {
      ana = await mk("Ana"); bia = await mk("Bia"); carla = await mk("Carla");
      const r = await recordInbound({ channelId: null, externalId: "F1", phoneRaw: "71998700001", body: "oi", at: new Date(Date.now() - 10 * MIN) });
      if (!("dealId" in r)) throw new Error();
      dealId = r.dealId;
      await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, dealId));
      // a distribuição acontece na chegada da mensagem (10 min atrás), não na hora em que o teste roda
      await db.update(dealEvents).set({ createdAt: new Date(Date.now() - 10 * MIN) }).where(eq(dealEvents.dealId, dealId));
      const since = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].awaitingReplySince!;
      await db.insert(alerts).values({ dealId, userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "x", dedupeKey: "late-f1", waitKey: waitKeyOf(dealId, since) });
    });

    it("quem assumiu ganha um prazo inteiro antes de nova oferta, e a oferta seguinte não volta para a dona antiga", async () => {
      await offerOverdue();
      const [o] = await db.select().from(alerts).where(like(alerts.waitKey, "oferta:%"));
      await claimDeal(dealId, o.userId!);
      expect((await offerOverdue(new Date(Date.now() + 30_000))).offered).toBe(0);
      await offerOverdue(new Date(Date.now() + 3 * MIN));
      const open = await db.select().from(alerts).where(and(like(alerts.waitKey, "oferta:%"), isNull(alerts.resolvedAt)));
      expect(open.map((x) => x.userId)).not.toContain(ana.id);
      void bia; void carla;
    });

    it("o alerta de atraso acompanha a conversa quando ela muda de dona (assumir, transferir)", async () => {
      await claimDeal(dealId, bia.id);
      expect((await waitAlert(dealId))[0].userId).toBe(bia.id);
      await transferDeal(dealId, carla.id, bia.id);
      expect((await waitAlert(dealId))[0].userId).toBe(carla.id);
    });

    it("devolvido à fila sem ninguém livre: o alerta vai para a gestão", async () => {
      await db.update(users).set({ availability: "pausa" }).where(eq(users.id, bia.id));
      await db.update(users).set({ availability: "pausa" }).where(eq(users.id, carla.id));
      await setAvailability(ana.id, "pausa");
      const [a] = await waitAlert(dealId);
      expect(a.userId).toBeNull();
      expect(a.audience).toBe("gestao");
    });
  });

  it("conversa que ficou sem dona é entregue quando alguém fica livre (a mais antiga primeiro)", async () => {
    const r1 = await recordInbound({ channelId: null, externalId: "U1", phoneRaw: "71998700011", body: "oi", at: new Date(Date.now() - 20 * MIN) });
    const r2 = await recordInbound({ channelId: null, externalId: "U2", phoneRaw: "71998700012", body: "oi", at: new Date(Date.now() - 5 * MIN) });
    if (!("dealId" in r1) || !("dealId" in r2)) throw new Error();
    expect((await db.select().from(deals).where(eq(deals.id, r1.dealId)))[0].ownerId).toBeNull(); // ninguém livre na chegada
    await saveDistributionSettings({ enabled: true, limit: 1 }, g.id);
    const ana = await mk("Ana");
    const out = await assignWaitingUnowned();
    expect(out.assigned).toBe(1);
    expect((await db.select().from(deals).where(eq(deals.id, r1.dealId)))[0].ownerId).toBe(ana.id);
    expect((await db.select().from(deals).where(eq(deals.id, r2.dealId)))[0].ownerId).toBeNull(); // limite 1
  });

  it("lead que chegou sem ninguém livre e depois ganhou dona: a oferta sai no prazo normal (o 'ninguém livre' não conta como troca de dona)", async () => {
    await saveDistributionSettings({ enabled: true, limit: 5 }, g.id);
    const r = await recordInbound({ channelId: null, externalId: "NL1", phoneRaw: "71998700099", body: "oi", at: new Date(Date.now() - 10 * MIN) });
    if (!("dealId" in r)) throw new Error();
    const ana = await mk("Ana"); await mk("Bia");
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, r.dealId)); // dona definida à mão, sem evento
    const since = (await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].awaitingReplySince!;
    await db.insert(alerts).values({ dealId: r.dealId, userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "x", dedupeKey: "late-nl1", waitKey: waitKeyOf(r.dealId, since) });
    expect((await offerOverdue()).offered).toBe(1);
  });
});
