// src/server/domain/authorship.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, messages, profiles, users } from "../db/schema";
import { importHistoryChat, recordInbound, recordOutbound } from "./deals";
import { resetDb } from "../../../test/db";

const T0 = new Date("2026-10-14T13:00:00Z"); // terça, 10h em Salvador
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
type U = typeof users.$inferSelect;
let sara: U, cati: U;
let c = 0, o = 0;

const person = async (name: string, key: "atendente" | "gestao", signature: string | null, active = true) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, key));
  return (await db.insert(users).values({ name, email: `${name.split(" ")[0].toLowerCase()}@c.com`, passwordHash: "x",
    role: key === "gestao" ? "gestor" : "atendente", profileId: p.id, signature, active }).returning())[0];
};
/** Conversa da cliente "Cliente N", com a dona pedida (sem dona por padrão). */
const conversa = async (ownerId: string | null = null) => {
  c++;
  const phone = `7199955${String(c).padStart(4, "0")}`;
  const r = await recordInbound({ channelId: null, externalId: `IN${c}`, phoneRaw: phone, pushName: `Cliente ${c}`, body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error();
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return { dealId: r.dealId, phone };
};
const pelocelular = (phone: string, body: string | null, at = min(2), kind = "text") =>
  recordOutbound({ phoneRaw: phone, channelId: null, externalId: `OUT${++o}`, body, kind, fromPhone: true, at });
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const outs = (dealId: string) => db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out")));
const avisos = () => db.select().from(alerts).where(eq(alerts.type, "respondida_por_outra"));

beforeEach(async () => {
  c = 0; o = 0; await resetDb();
  sara = await person("Sara Lima", "atendente", "SARA");
  cati = await person("Catarina Moura", "gestao", "CATI");
});

describe("autoria pela assinatura", () => {
  it("resposta assinada pelo celular registra a autora e por onde saiu", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*SARA - CASA FIAES:*\nOlá! Tudo bem?");
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: sara.id, sentVia: "celular", fromPhone: true });
    expect(await deal(dealId)).toMatchObject({ lastReplyById: sara.id, lastReplyVia: "celular" });
  });

  it("conversa sem dona respondida pelo CRM: quem respondeu vira a dona e o histórico registra (pelo CRM)", async () => {
    const { dealId, phone } = await conversa();
    await recordOutbound({ phoneRaw: phone, channelId: null, externalId: `OUT${++o}`, body: "*SARA - CASA FIAES:*\nOi", kind: "text", userId: sara.id, at: min(2) });
    expect((await deal(dealId)).ownerId).toBe(sara.id);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "assumiu")));
    expect(ev).toMatchObject({ userId: sara.id, payload: { de: null, para: sara.id, motivo: "resposta_crm" } });
  });

  it("conversa sem dona: quem assinou vira a dona, inclusive a gestão; o histórico e o tempo de resposta contam para ela", async () => {
    const a = await conversa(); const b = await conversa();
    await pelocelular(a.phone, "*SARA - CASA FIAES:*\nOi");
    await pelocelular(b.phone, "*CATI - CASA FIAES:*\nOi");
    expect((await deal(a.dealId)).ownerId).toBe(sara.id);
    expect((await deal(b.dealId)).ownerId).toBe(cati.id);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, b.dealId), eq(dealEvents.type, "assumiu")));
    expect(ev).toMatchObject({ userId: cati.id, payload: { de: null, para: cati.id, motivo: "assinatura" } });
    const [resp] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, b.dealId), eq(dealEvents.type, "resposta")));
    expect(resp.userId).toBe(cati.id);
  });

  it("com dona (29/10): quem responde assume a conversa e a antiga dona recebe UM aviso", async () => {
    const { dealId, phone } = await conversa(sara.id);
    await pelocelular(phone, "*CATI - CASA FIAES:*\nOi", min(2));
    await recordInbound({ channelId: null, externalId: "IN-X", phoneRaw: phone, body: "e aí?", at: min(3) });
    await pelocelular(phone, "*CATI - CASA FIAES:*\nJá vejo", min(4));
    expect(await deal(dealId)).toMatchObject({ ownerId: cati.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    const a = await avisos();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: sara.id, audience: "responsavel", dealId });
    expect(a[0].message).toBe("Cati respondeu a conversa de Cliente 1. A conversa passou para ela (quem responde assume).");
  });

  it("a dona respondendo a própria conversa (pelo celular e depois pelo CRM) não gera aviso", async () => {
    const { dealId, phone } = await conversa(sara.id);
    await pelocelular(phone, "*SARA - CASA FIAES:*\nOi", min(2));
    await recordOutbound({ dealId, channelId: null, body: "Tudo certo?", userId: sara.id, at: min(3) });
    expect(await avisos()).toHaveLength(0);
    expect(await deal(dealId)).toMatchObject({ ownerId: sara.id, lastReplyById: sara.id, lastReplyVia: "crm" });
  });

  it("foto com legenda assinada na mesma linha conta a autora e dá a dona", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*CATI - CASA FIAES:* Segue a foto do resultado", min(2), "image");
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: cati.id, sentVia: "celular" });
    expect((await deal(dealId)).ownerId).toBe(cati.id);
  });

  it("sem assinatura (áudio), assinatura no meio do texto ou nome desconhecido: não muda autora nem dona", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*MARIA - CASA FIAES:*\nOi", min(2));
    await pelocelular(phone, "Oi! A *SARA - CASA FIAES:* pediu para avisar", min(3));
    await pelocelular(phone, null, min(4), "audio");
    expect((await deal(dealId)).ownerId).toBeNull();
    expect((await outs(dealId)).map((m) => [m.sentByUserId, m.sentVia])).toEqual([[null, "celular"], [null, "celular"], [null, "celular"]]);
    expect(await avisos()).toHaveLength(0);
  });

  it("assinatura de quem foi desativada registra a autora, mas não vira dona", async () => {
    const ex = await person("Ex Atendente", "atendente", "EX", false);
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*EX - CASA FIAES:*\nOi");
    expect((await outs(dealId))[0].sentByUserId).toBe(ex.id);
    expect((await deal(dealId)).ownerId).toBeNull();
  });

  it("a Casa começa a conversa pelo celular assinando: a conversa nova já nasce com a dona", async () => {
    const r = await recordOutbound({ phoneRaw: "71988887777", channelId: null, externalId: "NOVA", body: "*CATI - CASA FIAES:*\nOi, Bruna!", fromPhone: true, at: T0 });
    if (!("dealId" in r) || !r.dealId) throw new Error();
    expect((await deal(r.dealId)).ownerId).toBe(cati.id);
  });

  it("pelo CRM a autora é quem está logada (o texto não decide)", async () => {
    const { dealId } = await conversa();
    await recordOutbound({ dealId, channelId: null, body: "*CATI - CASA FIAES:*\nOi", userId: sara.id, at: min(2) });
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: sara.id, sentVia: "crm" });
    expect((await deal(dealId)).ownerId).toBe(sara.id);
  });

  it("mensagem automática não tem autora nem muda a dona", async () => {
    const { dealId } = await conversa();
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nLembrete", automated: true, at: min(2) });
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: null, sentVia: null });
    expect((await deal(dealId)).ownerId).toBeNull();
  });

  it("histórico do WhatsApp: a mensagem assinada ganha autora e a conversa nova, a dona", async () => {
    const r = await importHistoryChat(null, "5571977776666@s.whatsapp.net", [
      { externalId: "H1", fromMe: false, at: new Date("2026-10-14T12:00:00Z"), kind: "text", body: "oi", pushName: "Lia" },
      { externalId: "H2", fromMe: true, at: new Date("2026-10-14T12:05:00Z"), kind: "text", body: "*CATI - CASA FIAES:*\nOi, Lia!" },
    ], new Date("2026-10-15T12:00:00Z"));
    if (!("dealId" in r) || !r.dealId) throw new Error();
    expect(await deal(r.dealId)).toMatchObject({ ownerId: cati.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    const [m] = await db.select().from(messages).where(eq(messages.externalId, "H2"));
    expect(m).toMatchObject({ sentByUserId: cati.id, sentVia: "celular" });
  });
});
