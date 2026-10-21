import { beforeEach, describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { conversationStatusOf, setConversationStatus } from "./conversation-status";

const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let sara = "", dealId = "";
const deal = async () => (await db.select().from(deals).where(eq(deals.id, dealId)))[0];
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71999990061", pushName: "Cliente Teste", body: "Oi, quanto custa a escova?", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
});

describe("status da conversa: Aberto, Aguardando, Resolvido", () => {
  it("automático: a cliente escreve → Aberto; a Casa responde → Aguardando", async () => {
    expect(await conversationStatusOf(dealId)).toBe("aberto");
    await recordOutbound({ dealId, channelId: null, body: "R$ 80", at: plus(2) });
    expect(await conversationStatusOf(dealId)).toBe("aguardando");
    await recordInbound({ channelId: null, externalId: "S2", phoneRaw: "71999990061", body: "Pode ser sábado?", at: plus(5), now: plus(5) });
    expect(await conversationStatusOf(dealId)).toBe("aberto");
  });

  it("à mão: Aguardando sai da espera e dos avisos; voltar para Aberto devolve a espera de antes", async () => {
    await db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "w1", waitKey: `${dealId}:${T0.toISOString()}` });
    expect(await setConversationStatus(dealId, "aguardando", sara, plus(10))).toEqual({ changed: true, before: "aberto" });
    expect((await deal()).awaitingReplySince).toBeNull();
    expect(await db.select().from(alerts).where(isNull(alerts.resolvedAt))).toHaveLength(0);
    await setConversationStatus(dealId, "aberto", sara, plus(11));
    expect((await deal()).awaitingReplySince).toEqual(T0);
  });

  it("Resolvido = o antigo Encerrar (sai da lista); Aberto ou Aguardando reabrem", async () => {
    await setConversationStatus(dealId, "resolvido", sara, plus(10));
    expect((await deal()).conversationArchivedAt).not.toBeNull();
    expect(await conversationStatusOf(dealId)).toBe("resolvido");
    await setConversationStatus(dealId, "aguardando", sara, plus(12));
    expect(await deal()).toMatchObject({ conversationArchivedAt: null, awaitingReplySince: null });
    await setConversationStatus(dealId, "resolvido", sara, plus(13));
    await setConversationStatus(dealId, "aberto", sara, plus(14));
    expect(await deal()).toMatchObject({ conversationArchivedAt: null, awaitingReplySince: plus(14) });
  });

  it("a mesma escolha não muda nada", async () => {
    expect(await setConversationStatus(dealId, "aberto", sara, plus(1))).toEqual({ changed: false, before: "aberto" });
  });

  it("ator null = Sistema (regras): Resolvido, Aguardando e Aberto registram o evento sem pessoa", async () => {
    await setConversationStatus(dealId, "resolvido", null, plus(10));
    expect((await deal()).conversationArchivedAt).not.toBeNull();
    await setConversationStatus(dealId, "aberto", null, plus(11));
    await setConversationStatus(dealId, "aguardando", null, plus(12));
    expect(await deal()).toMatchObject({ conversationArchivedAt: null, awaitingReplySince: null, resolvedById: null });
    const evs = await db.select({ type: dealEvents.type, userId: dealEvents.userId }).from(dealEvents).where(eq(dealEvents.dealId, dealId));
    for (const t of ["conversa_arquivada", "conversa_desarquivada", "resolvida"]) expect(evs.find((e) => e.type === t)).toEqual({ type: t, userId: null });
  });
});
