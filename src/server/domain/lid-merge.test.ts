import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, appointments, clientNotes, clientPhotos, contactNotes, contacts, dealEvents, deals, messages, stages, users } from "../db/schema";
import { getContact } from "../queries/contact";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { mergeLidInto } from "./lid-merge";

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" });
});
const t = (min: number) => new Date(Date.now() - min * 60_000);

describe("juntar número oculto (@lid) com o número de verdade", () => {
  it("a resposta da Casa que caiu no contato oculto passa para a conversa da cliente, que deixa de estar atrasada", async () => {
    const r = await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571999990001", pushName: "Rita", body: "oi, tem horário?", at: t(30) });
    if (!("dealId" in r)) throw new Error();
    await db.insert(alerts).values({ dealId: r.dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `espera:${r.dealId}` });
    // a Casa respondeu pelo ChatGuru, e o WhatsApp mandou só o @lid
    await recordOutbound({ phoneRaw: "", lid: "777", channelId: null, externalId: "OUT1", body: "Oi Rita! Tenho sim", fromPhone: true, at: t(25) });
    expect(await db.select().from(contacts)).toHaveLength(2);

    const res = await mergeLidInto("777", "+5571999990001");
    expect(res).toMatchObject({ merged: true });
    const cs = await db.select().from(contacts);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ phoneE164: "+5571999990001", waLid: "777" });
    const [d] = await db.select().from(deals).where(and(isNull(deals.closedAt), isNull(deals.archivedAt)));
    expect(d.id).toBe(r.dealId);
    expect(d.awaitingReplySince).toBeNull();
    expect((await db.select().from(messages).where(eq(messages.dealId, r.dealId))).map((m) => m.body)).toEqual(["oi, tem horário?", "Oi Rita! Tenho sim"]);
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, r.dealId), isNull(alerts.resolvedAt)))).toHaveLength(0);
  });

  it("horário na agenda, foto e nota interna do contato oculto passam para a cliente (prod 24–26/10: a junção travava ~1000x/dia no horário)", async () => {
    await recordInbound({ channelId: null, externalId: "IN8", phoneRaw: "5571999990008", pushName: "Rita", body: "oi", at: t(30) });
    await recordOutbound({ phoneRaw: "", lid: "888", channelId: null, externalId: "OUT8", body: "Oi Rita", fromPhone: true, at: t(25) });
    const [hidden] = await db.select().from(contacts).where(eq(contacts.waLid, "888"));
    await db.insert(appointments).values({ contactId: hidden.id, serviceLabel: "Corte", status: "agendado", origin: "crm", externalKey: "t:888", startsAt: new Date(Date.now() + 86_400_000), durationMin: 60 });
    await db.insert(clientPhotos).values({ contactId: hidden.id, kind: "antes", mediaPath: "fotos/x.jpg", mediaMime: "image/jpeg" });
    await db.insert(contactNotes).values({ contactId: hidden.id, body: "Prefere à tarde" });
    expect(await mergeLidInto("888", "+5571999990008")).toMatchObject({ merged: true });
    const [real] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990008"));
    expect((await db.select().from(appointments)).map((a) => a.contactId)).toEqual([real.id]);
    expect((await db.select().from(clientPhotos)).map((a) => a.contactId)).toEqual([real.id]);
    expect((await db.select().from(contactNotes)).map((a) => [a.contactId, a.body])).toEqual([[real.id, "Prefere à tarde"]]);
  });

  it("a ficha técnica (Lote 7A) anotada no contato oculto passa para a cliente", async () => {
    await recordInbound({ channelId: null, externalId: "IN9", phoneRaw: "5571999990009", pushName: "Rita", body: "oi", at: t(30) });
    await recordOutbound({ phoneRaw: "", lid: "999", channelId: null, externalId: "OUT9", body: "Oi Rita", fromPhone: true, at: t(25) });
    const [hidden] = await db.select().from(contacts).where(eq(contacts.waLid, "999"));
    const [ana] = await db.select().from(users);
    await db.insert(clientNotes).values({ contactId: hidden.id, authorId: ana.id, body: "Alérgica a amônia" });
    expect(await mergeLidInto("999", "+5571999990009")).toMatchObject({ merged: true });
    const [real] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990009"));
    expect((await db.select().from(clientNotes)).map((n) => [n.contactId, n.body])).toEqual([[real.id, "Alérgica a amônia"]]);
  });

  it("se a cliente escreveu de novo depois da resposta, continua esperando (a espera conta da mensagem nova)", async () => {
    await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571999990002", body: "oi", at: t(40) });
    await recordOutbound({ phoneRaw: "", lid: "888", channelId: null, externalId: "OUT1", body: "Oi!", fromPhone: true, at: t(35) });
    await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "5571999990002", body: "e o preço?", at: t(10) });
    await mergeLidInto("888", "+5571999990002");
    const [d] = await db.select().from(deals).where(isNull(deals.archivedAt));
    expect(d.awaitingReplySince).not.toBeNull();
    expect(Math.abs(d.awaitingReplySince!.getTime() - t(10).getTime())).toBeLessThan(5_000);
  });

  it("só existe o oculto: ele ganha o número de verdade", async () => {
    await recordOutbound({ phoneRaw: "", lid: "999", channelId: null, externalId: "OUT1", body: "Oi!", fromPhone: true });
    const res = await mergeLidInto("999", "+5571999990003");
    expect(res).toMatchObject({ renamed: true });
    const [c] = await db.select().from(contacts);
    expect(c).toMatchObject({ phoneE164: "+5571999990003", waLid: "999" });
  });

  it("sem contato oculto: o contato do número só aprende o @lid; rodar de novo não faz nada", async () => {
    await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571999990004", body: "oi" });
    expect(await mergeLidInto("111", "+5571999990004")).toMatchObject({ learned: true });
    expect(await mergeLidInto("111", "+5571999990004")).toMatchObject({ nothing: true });
    expect((await db.select().from(contacts))[0].waLid).toBe("111");
  });
});

describe("sincronização com os pares da Evolution", () => {
  it("junta só os contatos ocultos cujo número apareceu", async () => {
    const { syncLidPairs } = await import("../whatsapp/lid-pairs");
    await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571999990005", body: "oi", at: t(20) });
    await recordOutbound({ phoneRaw: "", lid: "555", channelId: null, externalId: "OUT1", body: "Oi!", fromPhone: true, at: t(15) });
    await recordOutbound({ phoneRaw: "", lid: "666", channelId: null, externalId: "OUT2", body: "Olá", fromPhone: true, at: t(15) });
    const r = await syncLidPairs(async () => [{ lid: "555", phone: "+5571999990005" }, { lid: "404", phone: "+5571999990009" }]);
    expect(r).toEqual({ merged: 1, renamed: 0 });
    expect((await db.select().from(contacts)).map((c) => c.phoneE164).sort()).toEqual(["+5571999990005", "lid:666"]);
  });
});

it("a conversa do número oculto que sai na junção fica marcada como mesclada (não como 'Não é cliente')", async () => {
  // dois contatos, cada um com conversa aberta: o oculto (lid) e o do número; depois juntar
  const hidden = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "lid:998877", waLid: "998877" }).returning())[0];
  const real = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000401" }).returning())[0];
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [h] = await db.insert(deals).values({ contactId: hidden.id, stageId: lead.id }).returning();
  await db.insert(deals).values({ contactId: real.id, stageId: lead.id });
  await mergeLidInto("998877", "+5571966000401");
  const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, h.id), eq(dealEvents.type, "contato_mesclado")));
  expect(ev).toHaveLength(1);
  const ficha = await getContact(real.id);
  expect(ficha!.deals.find((x) => x.id === h.id)).toMatchObject({ archived: true, merged: true });
});
