import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, messages, stages, contacts, users, dealEvents } from "../db/schema";
import { recordInbound, recordOutbound, moveDeal, detectOrigin } from "./deals";
import { resetDb } from "../../../test/db";

async function stageKeyOf(dealId: string) {
  const [r] = await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
  return r.key;
}

describe("fluxo do lead", () => {
  beforeEach(resetDb);

  it("mensagem nova cria contato e lead na etapa Lead, esperando resposta", async () => {
    const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "5571999812244@s.whatsapp.net", pushName: "Mariana", body: "Oi! Queria saber o valor" });
    expect("dealId" in r && !("duplicate" in r) && r.created).toBe(true);
    if (!("dealId" in r)) throw new Error();
    expect(await stageKeyOf(r.dealId)).toBe("lead");
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.awaitingReplySince).not.toBeNull();
    const [c] = await db.select().from(contacts);
    expect(c.name).toBe("Mariana");
    expect(c.phoneE164).toBe("+5571999812244");
  });

  it("mesmo webhook duas vezes não duplica mensagem nem lead", async () => {
    const input = { channelId: null, externalId: "DUP", phoneRaw: "71999812244", body: "oi" };
    await recordInbound(input);
    const r2 = await recordInbound(input);
    expect("duplicate" in r2).toBe(true);
    expect((await db.select().from(messages)).length).toBe(1);
    expect((await db.select().from(deals)).length).toBe(1);
  });

  it("segunda mensagem mantém o início da espera (não zera o cronômetro)", async () => {
    const t0 = new Date("2026-10-09T10:00:00Z"), t1 = new Date("2026-10-09T10:01:30Z");
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999812244", body: "oi", at: t0 });
    await recordInbound({ channelId: null, externalId: "M2", phoneRaw: "71999812244", body: "alô?", at: t1 });
    if (!("dealId" in r)) throw new Error();
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.awaitingReplySince?.toISOString()).toBe(t0.toISOString());
  });

  it("resposta pelo celular (fromMe) conta e move Lead → Atendimento com tempo de espera registrado", async () => {
    const t0 = new Date("2026-10-09T10:00:00Z");
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999812244", body: "oi", at: t0 });
    if (!("dealId" in r)) throw new Error();
    const out = await recordOutbound({ phoneRaw: "557199812244@s.whatsapp.net", channelId: null, externalId: "O1", body: "Oi!", fromPhone: true, at: new Date(t0.getTime() + 95_000) });
    expect("messageId" in out).toBe(true);
    expect(await stageKeyOf(r.dealId)).toBe("atendimento");
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.awaitingReplySince).toBeNull();
    expect(d.firstResponseAt).not.toBeNull();
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.type, "resposta"));
    expect(ev[0].payload).toMatchObject({ waitedSeconds: 95, first: true, fromPhone: true });
  });

  it("cliente que responde no follow-up volta para Atendimento", async () => {
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await moveDeal(r.dealId, "followup_2", null);
    await recordInbound({ channelId: null, externalId: "M2", phoneRaw: "71999812244", body: "voltei" });
    expect(await stageKeyOf(r.dealId)).toBe("atendimento");
  });

  it("lead fechado: nova mensagem abre um lead novo", async () => {
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999812244", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await moveDeal(r.dealId, "fechado", null);
    const r2 = await recordInbound({ channelId: null, externalId: "M2", phoneRaw: "71999812244", body: "quero de novo" });
    expect("created" in r2 && r2.created).toBe(true);
  });

  it("telefone de grupo é ignorado", async () => {
    expect(await recordInbound({ channelId: null, externalId: "G", phoneRaw: "1203630@g.us", body: "x" })).toEqual({ skipped: "telefone_invalido" });
  });

  it("mensagem da Casa pelo celular para quem não está no CRM vira lead", async () => {
    const r = await recordOutbound({ phoneRaw: "71988887777", channelId: null, externalId: "X", body: "oi", fromPhone: true });
    expect(r).toMatchObject({ dealId: expect.any(String), messageId: expect.any(String) });
  });

  it("sem ser pelo celular (sem contato) continua ignorada", async () => {
    expect(await recordOutbound({ phoneRaw: "71988887777", channelId: null, externalId: "X", body: "oi" })).toEqual({ skipped: "sem_contato" });
  });

  it("distribui para a atendente com menos leads", async () => {
    await db.insert(users).values([
      { name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" },
      { name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" },
    ]);
    const owners = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = await recordInbound({ channelId: null, externalId: `E${i}`, phoneRaw: `7199900000${i}`, body: "oi" });
      if (!("dealId" in r)) throw new Error();
      const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
      owners.add(d.ownerId!);
    }
    expect(owners.size).toBe(2);
  });

  it("detecta origem", () => {
    expect(detectOrigin({ body: "Oi, vim pelo Instagram!" })).toBe("Instagram");
    expect(detectOrigin({ hasAdReferral: true })).toBe("Anúncio");
    expect(detectOrigin({ body: "a Carla me indicou" })).toBe("Indicação");
    expect(detectOrigin({ isClient: true })).toBe("Já é cliente");
    expect(detectOrigin({ body: "oi" })).toBe("WhatsApp");
  });
});
