import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { resolveWithoutReply, undoResolve } from "./resolve";

const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let sara = "", dealId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990051", pushName: "Cliente Teste", body: "Vou ver com meu marido e te falo", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  await db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Cliente Teste espera resposta", dedupeKey: "w1", waitKey: `${dealId}:${T0.toISOString()}` });
});
const deal = async () => (await db.select().from(deals).where(eq(deals.id, dealId)))[0];

describe("Resolvido (não precisa responder)", () => {
  it("encerra a espera sem mandar nada: sai do prazo e dos avisos; a etapa não muda e a conversa continua na Fila", async () => {
    const before = await deal();
    expect((await resolveWithoutReply(dealId, sara, plus(10))).resolved).toBe(true);
    const after = await deal();
    expect(after).toMatchObject({ awaitingReplySince: null, resolvedById: sara, resolvedAt: plus(10), stageId: before.stageId, conversationArchivedAt: null, lastOutboundAt: null });
    expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resolvida")));
    expect(ev.map((e) => [e.payload, e.userId])).toEqual([[{ desde: T0.toISOString() }, sara]]);
  });

  it("sem espera, não há o que resolver", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    expect((await resolveWithoutReply(dealId, sara, plus(11))).resolved).toBe(false);
  });

  it("a cliente escreve de novo: volta a esperar resposta", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71999990051", body: "Falei com ele, pode ser sábado?", at: plus(20), now: plus(20) });
    expect((await deal()).awaitingReplySince).toEqual(plus(20));
  });

  it("Desfazer devolve a espera de onde estava; depois que a Casa respondeu, não desfaz", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    await undoResolve(dealId, sara);
    expect(await deal()).toMatchObject({ awaitingReplySince: T0, resolvedAt: null, resolvedById: null });
    await resolveWithoutReply(dealId, sara, plus(12));
    await recordOutbound({ dealId, channelId: null, body: "Combinado!", userId: sara, at: plus(15) });
    await expect(undoResolve(dealId, sara)).rejects.toThrow(/A Casa já respondeu/);
  });

  it("conversa marcada como “Não é cliente” ou fechada: recusa", async () => {
    await db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, dealId));
    await expect(resolveWithoutReply(dealId, sara)).rejects.toThrow(/não está mais aberta/);
  });
});
