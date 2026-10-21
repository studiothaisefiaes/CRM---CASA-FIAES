import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, deals, messages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { callOutcome, ingestEvolution, parseContent } from "./webhook";
import { WEBHOOK_EVENTS } from "./evolution";
import { fromPhone, inboundText } from "../../../test/fixtures/evolution";
import { lidLookup } from "./lid-pairs";

const JID = "5571999990061@s.whatsapp.net";
const CLIENT = "5571999812244@s.whatsapp.net"; // o número dos fixtures inboundText/fromPhone
const TS = 1791550931; // 2026-10-09T13:02:11Z
const at = (secs: number) => new Date((TS + secs) * 1000).toISOString();
const callLog = (id: string, outcome: number | string, o: { fromMe?: boolean; video?: boolean; secs?: number; ts?: number } = {}) => ({ event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: JID, fromMe: !!o.fromMe, id }, pushName: "Cliente Teste Um", message: { callLogMesssage: { isVideo: !!o.video, callOutcome: outcome, durationSecs: o.secs ?? 0 }, messageContextInfo: {} }, messageTimestamp: o.ts ?? TS } });
const callEvent = (id: string, status: string, when = 30, extra: Record<string, unknown> = {}) => ({ event: "call", instance: "casa-principal",
  data: { id, from: JID, chatId: JID, status, isVideo: false, isGroup: false, date: at(when), offline: false, ...extra } });
const reaction = (id: string, target: string, text: string, fromMe = false, jid = CLIENT) => ({ event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: jid, fromMe, id }, message: { reactionMessage: { key: { id: target, remoteJid: jid, fromMe: !fromMe }, text } }, messageTimestamp: TS + 120 } });
const calls = async () => (await db.select().from(messages)).filter((m) => m.kind === "call");
const callAlerts = async () => (await db.select().from(alerts)).filter((a) => a.type === "ligacao_sem_nota");

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "casa-principal", status: "conectado", phone: "+557133330000" });
});

describe("ligação que chega só com o @lid (20/10)", () => {
  it("o número é conhecido: a ligação cai na conversa da cliente cadastrada, sem contato 'Número oculto' novo", async () => {
    const [cliente] = await db.insert(contacts).values({ name: "Sônia Fictícia", phoneE164: "+5571999990061" }).returning();
    vi.spyOn(lidLookup, "phoneForLid").mockResolvedValue("+5571999990061");
    await ingestEvolution(callEvent("L1", "terminate", 30, { from: "208000000000001@lid", chatId: "208000000000001@lid" }));
    const all = await db.select().from(contacts);
    expect(all.map((c) => c.phoneE164)).toEqual(["+5571999990061"]);
    expect((await calls())[0].contactId).toBe(cliente.id);
    vi.restoreAllMocks();
  });
});

describe("ligações: o registro do WhatsApp (callLogMesssage)", () => {
  it("o resultado diz atendida, perdida ou recusada (número ou nome do WhatsApp); em andamento ainda não entra", () => {
    expect(callOutcome({ callOutcome: 1 })).toEqual({ status: "perdida", video: false });
    expect(callOutcome({ callOutcome: "REJECTED", isVideo: true })).toEqual({ status: "recusada", video: true });
    expect(callOutcome({ callOutcome: 0 })).toEqual({ status: "atendida", video: false });
    expect(callOutcome({ callOutcome: "ACCEPTED_ELSEWHERE" })).toEqual({ status: "atendida", video: false });
    expect(callOutcome({ callOutcome: 5 })).toBeNull();
    expect(callOutcome({})).toBeNull();
    expect(parseContent({ callLogMesssage: { callOutcome: "ONGOING" } } as never)).toBeNull();
    expect(parseContent({ callLogMesssage: { callOutcome: "MISSED" } } as never)).toMatchObject({ kind: "call" });
  });

  it("ligação perdida entra na conversa e abre a espera (a cliente quer falar)", async () => {
    await ingestEvolution(callLog("C1", 1));
    const [c] = await calls();
    expect(c).toMatchObject({ direction: "in", body: "Ligação perdida", call: { status: "perdida", video: false } });
    expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
    expect(await callAlerts()).toHaveLength(0);
  });

  it("ligação recebida e atendida: item com a duração do WhatsApp, sem abrir espera, com lembrete de anotar", async () => {
    await ingestEvolution(callLog("C2", 0, { secs: 185 }));
    const [c] = await calls();
    expect(c).toMatchObject({ direction: "in", body: "Ligação recebida · atendida · 3 min", call: { status: "atendida", durationSecs: 185 } });
    expect((await db.select().from(deals))[0].awaitingReplySince).toBeNull();
    const [a] = await callAlerts();
    expect(a).toMatchObject({ severity: "info", dealId: c.dealId });
    expect(a.message).toContain("Anote a ligação");
  });

  it("atendida sem os segundos: só o status, nunca uma duração inventada", async () => {
    await ingestEvolution(callLog("C3", "CONNECTED"));
    expect((await calls())[0]).toMatchObject({ body: "Ligação recebida · atendida" });
    expect((await calls())[0].call?.durationSecs ?? null).toBeNull();
  });

  it("ligação feita pela Casa vira item (feita/atendida ou não atendida) e não abre espera nem conta como resposta", async () => {
    await ingestEvolution(callLog("C4", 0, { fromMe: true, secs: 60 }));
    await ingestEvolution(callLog("C5", 1, { fromMe: true, ts: TS + 3600 }));
    const list = (await calls()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(list.map((m) => [m.direction, m.body])).toEqual([["out", "Ligação feita · atendida · 1 min"], ["out", "Ligação feita · não atendida"]]);
    expect(list.every((m) => m.sentByUserId === null)).toBe(true);
    const [d] = await db.select().from(deals);
    expect(d.awaitingReplySince).toBeNull();
    expect(d.firstResponseAt).toBeNull();
  });
});

describe("ligações: evento CALL da Evolution (offer/accept/terminate/reject/timeout)", () => {
  it("tocando não entra; atendeu → item atendido; terminou → a duração (atendeu → terminou) e o lembrete", async () => {
    await ingestEvolution(callEvent("X1", "offer", 0));
    expect(await calls()).toHaveLength(0);
    await ingestEvolution(callEvent("X1", "accept", 10));
    expect((await calls())[0]).toMatchObject({ externalId: "call:X1", direction: "in", body: "Ligação recebida · atendida", call: { status: "atendida" } });
    expect((await db.select().from(deals))[0].awaitingReplySince).toBeNull();
    await ingestEvolution(callEvent("X1", "terminate", 190));
    const [c] = await calls();
    expect(c).toMatchObject({ body: "Ligação recebida · atendida · 3 min", call: { status: "atendida", durationSecs: 180 } });
    expect(await callAlerts()).toHaveLength(1);
  });

  it("ninguém atendeu, recusada ou terminou sem atender: perdida/recusada, abre a espera; grupo nunca entra", async () => {
    await ingestEvolution(callEvent("X9", "timeout", 30, { isGroup: true }));
    expect(await calls()).toHaveLength(0);
    await ingestEvolution(callEvent("X2", "timeout"));
    await ingestEvolution(callEvent("X2", "terminate", 40)); // o fim depois do timeout não muda nada
    await ingestEvolution(callEvent("X3", "reject", 600));
    await ingestEvolution(callEvent("X4", "terminate", 1200)); // terminou sem "accept": atendida no celular ou não, o aparelho não avisa
    const list = (await calls()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(list.map((m) => [m.externalId, m.body])).toEqual([["call:X2", "Ligação perdida"], ["call:X3", "Ligação recusada"], ["call:X4", "Ligação recebida"]]);
    expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
    expect(await callAlerts()).toHaveLength(0);
  });

  it("recebida sem saber o resultado vira atendida quando o registro da conversa chega com CONNECTED", async () => {
    await ingestEvolution(callEvent("X7", "terminate"));
    await ingestEvolution(callLog("C7", "CONNECTED"));
    const list = await calls();
    expect(list).toHaveLength(1);
    expect(list[0].call?.status).toBe("atendida");
  });

  it("a mesma ligação pelos dois caminhos (evento CALL e registro da conversa) vira uma linha só", async () => {
    await ingestEvolution(callEvent("X5", "timeout"));
    await ingestEvolution(callLog("C6", "MISSED"));
    expect(await calls()).toHaveLength(1);
  });

  it("atendida pelos dois caminhos: uma linha, a duração dos eventos e um lembrete só", async () => {
    await ingestEvolution(callEvent("X6", "accept", 5));
    await ingestEvolution(callEvent("X6", "terminate", 125));
    await ingestEvolution(callLog("C7", 0, { secs: 121, ts: TS + 5 }));
    const list = await calls();
    expect(list).toHaveLength(1);
    expect(list[0].call?.durationSecs).toBe(120);
    expect(await callAlerts()).toHaveLength(1);
  });

  it("o registro chega antes do fim: o evento depois só completa", async () => {
    await ingestEvolution(callLog("C8", 0, { ts: TS + 5 }));
    await ingestEvolution(callEvent("X7", "accept", 5));
    await ingestEvolution(callEvent("X7", "terminate", 65));
    expect(await calls()).toHaveLength(1);
  });

  it("o webhook pede as ligações à Evolution", () => {
    expect(WEBHOOK_EVENTS).toContain("CALL");
  });
});

describe("reações", () => {
  const m = async (ext: string) => (await db.select().from(messages).where(eq(messages.externalId, ext)))[0];

  it("reação da cliente fica na mensagem da Casa; tirar a reação limpa; não vira mensagem nem abre espera", async () => {
    await ingestEvolution(inboundText("M1"));
    await ingestEvolution(fromPhone("M2"));
    const before = (await db.select().from(deals))[0].awaitingReplySince;
    await ingestEvolution(reaction("R1", "M2", "❤️"));
    expect((await m("M2")).reactions).toEqual({ cliente: "❤️" });
    expect(await db.select().from(messages)).toHaveLength(2);
    expect((await db.select().from(deals))[0].awaitingReplySince).toEqual(before);
    await ingestEvolution(reaction("R2", "M2", ""));
    expect((await m("M2")).reactions).toBeNull();
  });

  it("reação da Casa (pelo celular) fica do lado da Casa", async () => {
    await ingestEvolution(inboundText("M1"));
    await ingestEvolution(reaction("R3", "M1", "👍", true));
    expect((await m("M1")).reactions).toEqual({ casa: "👍" });
  });

  it("reação a mensagem que não está no CRM: sem erro, sem contato novo, sem mensagem", async () => {
    const r = await ingestEvolution(reaction("R4", "NAO-EXISTE", "😂", false, JID));
    expect(r).toMatchObject({ ok: true, kind: "reaction", found: false });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });
});
