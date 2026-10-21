import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, sql, ne } from "drizzle-orm";
import { db } from "../db";
import { automations, channels, contacts, settings, outbox, deals, tasks, messages, alerts, users, dealEvents } from "../db/schema";
import { enqueueAutomated, drainOutbox } from "./outbox";
import { recordInbound as recordInboundReal } from "./deals";
import { archiveDeals } from "./archive";
import { ingestEvolution, type EvoPayload } from "../whatsapp/webhook";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { runRules } from "../rules/engine";
import { sendHooks } from "./send";
import { ProviderError } from "../whatsapp/provider";
import { UNCERTAIN_SEND_MESSAGE } from "./send";
import { pool } from "../db";
import { OUTBOX_LOCK_KEY } from "./outbox";
import { resetDb } from "../../../test/db";
import { scheduleAutomation } from "../../../test/schedule-automations";
import { AUTO_REPLY_SUGGESTED } from "../../lib/auto-message-text";
// O aviso "a cliente escreveu" (toda mensagem da cliente) tem teste próprio (client-message-alert.test): aqui contam os outros avisos.
const otherAlerts = () => db.select().from(alerts).where(ne(alerts.type, "mensagem_cliente"));

// Relógio do teste = hora da mensagem (a resposta fora do horário confere o relógio real; aqui ele é injetado).
const recordInbound = (i: Parameters<typeof recordInboundReal>[0]) => recordInboundReal({ now: i.at, ...i });

// Provider falso: nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
let failNext = 0;
let failWith: (() => Error) | null = null;
let textCalls = 0;
let beforeFail: (() => Promise<void>) | null = null;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { textCalls++; if (failWith) { await beforeFail?.(); throw failWith(); } if (failNext > 0) { failNext--; throw new ProviderError("Evolution respondeu 500: fora do ar", 500); } sent.push(text); return { externalId: "OUT" + sent.length }; },
  sendPoll: async (_i: string, _to: string, name: string, options: string[]) => { sent.push("poll:" + name + ":" + options.join("|")); return { externalId: "POLL1" }; },
};
let chId = "";
const lead = async (phone: string, at: Date) => { const r = await recordInbound({ channelId: chId, externalId: phone + at.getTime(), phoneRaw: phone, body: "oi", at }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
beforeEach(async () => {
  sent.length = 0; failNext = 0; failWith = null; textCalls = 0; beforeFail = null; await resetDb(); setWhatsappProvider(fake);
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});
afterEach(async () => { await db.execute(sql`drop trigger if exists t12_trg on messages`); setWhatsappProvider(null); sendHooks.beforeConfirm = undefined; });

describe("fila de envios automáticos", () => {
  const t0 = new Date("2026-10-13T13:00:00Z"); // ter 10h em Salvador (aberto)
  it("teto por hora: com teto 2, 3 envios → 2 agora e 1 na hora seguinte", async () => {
    await db.insert(settings).values({ key: "envio_teto_hora", value: 2 });
    for (const p of ["71999990101", "71999990102", "71999990103"]) await enqueueAutomated({ dealId: await lead(p, t0), kind: "text", text: "lembrete " + p });
    await drainOutbox(t0);
    expect(sent).toHaveLength(2);
    await drainOutbox(new Date(t0.getTime() + 61 * 60_000));
    expect(sent).toHaveLength(3);
  });
  it("sem a configuração, o teto padrão é 30 por hora", async () => {
    for (let i = 0; i < 32; i++) await enqueueAutomated({ dealId: await lead("719999902" + String(i).padStart(2, "0"), t0), kind: "text", text: "m" + i });
    await drainOutbox(t0);
    expect(sent).toHaveLength(30);
  });
  it("grava como saída automática (sem autor) e o eco do WhatsApp não duplica", async () => {
    const id = await lead("71999990111", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "Oi, lembrete" });
    await drainOutbox(t0);
    const out = await db.select().from(messages).where(and(eq(messages.dealId, id), eq(messages.direction, "out")));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "sent", sentByUserId: null, externalId: "OUT1", body: "Oi, lembrete" });
    await ingestEvolution({ event: "send.message", instance: "rec", data: { key: { remoteJid: "557199990111@s.whatsapp.net", fromMe: true, id: "OUT1" }, message: { conversation: "Oi, lembrete" }, messageTimestamp: 1 } });
    expect(await db.select().from(messages).where(and(eq(messages.dealId, id), eq(messages.direction, "out")))).toHaveLength(1);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "sent" });
  });
  it("cancela na hora de enviar: lead arquivado, contato ignorado, canal em modo quieto ou automação desligada", async () => {
    const [a, b, c, d] = [await lead("71999990121", t0), await lead("71999990122", t0), await lead("71999990123", t0), await lead("71999990124", t0)];
    const [u] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    await archiveDeals([a], u.id);
    const [db1] = await db.select().from(deals).where(eq(deals.id, b));
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, db1.contactId));
    const auto = await scheduleAutomation("texto", { enabled: false });
    await enqueueAutomated({ dealId: a, kind: "text", text: "x" });
    await enqueueAutomated({ dealId: b, kind: "text", text: "x" });
    await enqueueAutomated({ dealId: d, kind: "text", text: "x", source: `automacao:${auto.id}` }); // automação desligada por padrão
    await drainOutbox(t0);
    expect(sent).toHaveLength(0);
    await enqueueAutomated({ dealId: c, kind: "text", text: "x" });
    await db.update(channels).set({ quietUntil: new Date(t0.getTime() + 3_600_000) }).where(eq(channels.id, chId));
    await drainOutbox(t0);
    expect(sent).toHaveLength(0);
    const rows = await db.select().from(outbox);
    expect(rows.map((r) => r.status)).toEqual(Array(4).fill("cancelled"));
    expect(rows.every((r) => !!r.error)).toBe(true);
  });
  it("falha de envio: até 3 tentativas com espera crescente e depois fica 'failed' com o erro", async () => {
    const id = await lead("71999990131", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "tenta" });
    failNext = 99;
    await drainOutbox(t0);
    let [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    await drainOutbox(new Date(t0.getTime() + 60_000)); // ainda na espera
    [row] = await db.select().from(outbox); expect(row.attempts).toBe(1);
    await drainOutbox(new Date(t0.getTime() + 10 * 60_000));
    [row] = await db.select().from(outbox); expect(row).toMatchObject({ status: "pending", attempts: 2 });
    await drainOutbox(new Date(t0.getTime() + 60 * 60_000));
    [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(row.error).toMatch(/fora do ar/);
    await drainOutbox(new Date(t0.getTime() + 5 * 3_600_000));
    expect((await db.select().from(outbox))[0].attempts).toBe(3);
    // só a última tentativa deixa mensagem "falhou" na conversa
    expect((await db.select().from(messages).where(eq(messages.dealId, id))).filter((m) => m.direction === "out").map((m) => m.status)).toEqual(["failed"]);
    expect((await otherAlerts()).some((a) => a.type === "envio_automatico_falhou")).toBe(true);
    const falha = (await otherAlerts()).find((a) => a.type === "envio_automatico_falhou")!;
    expect(falha.message).toMatch(/^Mensagem automática para .+ não saiu \(3 tentativas sem sucesso\)\. Abra a conversa e envie manualmente\.$/);
    expect(falha.message).not.toMatch(/\+55/);
  });
  it("fora do expediente só sai a resposta automática; o resto espera abrir", async () => {
    const id = await lead("71999990141", t0);
    const night = new Date("2026-10-14T02:00:00Z");
    await enqueueAutomated({ dealId: id, kind: "text", text: "lembrete" });
    await drainOutbox(night);
    expect(sent).toHaveLength(0);
    await drainOutbox(new Date("2026-10-14T11:00:00Z"));
    expect(sent).toEqual(["lembrete"]);
  });
  it("enquete sai pelo provider com as opções e fica como 'poll' na conversa", async () => {
    const id = await lead("71999990151", t0);
    await enqueueAutomated({ dealId: id, kind: "poll", text: "Confirma seu horário?", options: ["Confirmo", "Preciso remarcar"] });
    await drainOutbox(t0);
    expect(sent).toEqual(["poll:Confirma seu horário?:Confirmo|Preciso remarcar"]);
    const [m] = await db.select().from(messages).where(and(eq(messages.dealId, id), eq(messages.kind, "poll")));
    expect(m).toMatchObject({ externalId: "POLL1", direction: "out", status: "sent", sentByUserId: null });
  });
});

describe("motor: ações de envio vão para a fila", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  it("enquete de confirmação: desligada não enfileira; ligada, enfileira 1 vez e a fila envia", async () => {
    const auto = await scheduleAutomation("enquete", { enabled: false });
    const id = await lead("71999990161", t0);
    await db.execute(`update deals set scheduled_at = '${new Date(t0.getTime() + 20 * 3_600_000).toISOString()}', stage_id = (select id from stages where key = 'agendado') where id = '${id}'` as never);
    await runRules(t0);
    expect(await db.select().from(outbox)).toHaveLength(0);
    await db.update(automations).set({ enabled: true }).where(eq(automations.id, auto.id));
    const s = await runRules(t0);
    expect(s.sent).toBe(1);
    await runRules(new Date(t0.getTime() + 60_000));
    expect(await db.select().from(outbox)).toHaveLength(1);
    expect(sent).toHaveLength(0); // o motor não envia: só enfileira
    await drainOutbox(t0);
    expect(sent[0]).toMatch(/^poll:.*Confirmo\|Preciso remarcar$/);
  });
});

describe("resposta fora do horário", () => {
  const night = new Date("2026-10-14T02:00:00Z"); // ter 23h em Salvador
  it("desligada por padrão: não enfileira nada", async () => {
    await lead("71999990201", night);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
  it("ligada: 1 vez a cada 12 h por contato e nunca no expediente", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi! A Casa abre às 8h." } });
    await lead("71999990202", night);
    await recordInbound({ channelId: chId, externalId: "x2", phoneRaw: "71999990202", body: "?", at: new Date(night.getTime() + 30 * 60_000) });
    expect(await db.select().from(outbox)).toHaveLength(1);
    await lead("71999990203", new Date("2026-10-14T13:00:00Z")); // qua 10h, aberto
    expect(await db.select().from(outbox)).toHaveLength(1);
  });
  it("passadas 12 h responde de novo; modo quieto e mensagem repetida (duplicada) não enfileiram", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi! A Casa abre às 8h." } });
    const id = await lead("71999990211", night);
    await recordInbound({ channelId: chId, externalId: "71999990211" + night.getTime(), phoneRaw: "71999990211", body: "oi", at: night }); // duplicada
    expect(await db.select().from(outbox)).toHaveLength(1);
    // a cliente é atendida (resposta) e, 13 h depois, escreve de novo de madrugada
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, id));
    const next = new Date(night.getTime() + 24 * 3_600_000);
    await recordInbound({ channelId: chId, externalId: "y1", phoneRaw: "71999990211", body: "oi de novo", at: next });
    expect(await db.select().from(outbox)).toHaveLength(2);
    // dentro das 12 h seguintes à resposta não repete (mesmo de madrugada)
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, id));
    await recordInbound({ channelId: chId, externalId: "y2", phoneRaw: "71999990211", body: "oi 3", at: new Date(next.getTime() + 3_600_000) });
    expect(await db.select().from(outbox)).toHaveLength(2);
  });
  it("texto sugerido (pesquisa 20/10): {abertura} vira o prazo concreto pelo expediente e {nome} o primeiro nome", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: AUTO_REPLY_SUGGESTED } });
    await recordInbound({ channelId: chId, externalId: "sug1", phoneRaw: "71999990231", pushName: "Maria Souza", body: "oi, tem horário?", at: night }); // ter 23h
    const sat = new Date("2026-10-17T21:30:00Z"); // sábado 18h30, depois do fechamento (8h–17h); domingo fechado
    await recordInbound({ channelId: chId, externalId: "sug2", phoneRaw: "71999990232", body: "oi", at: sat });
    const texts = (await db.select({ t: outbox.text }).from(outbox)).map((r) => r.t).sort();
    expect(texts).toEqual([
      "Oi! Agora estamos fechadas; respondemos na segunda a partir das 8h. Para adiantar, me conta o serviço e o dia que você prefere?",
      "Oi, Maria! Agora estamos fechadas; respondemos amanhã a partir das 8h. Para adiantar, me conta o serviço e o dia que você prefere?",
    ]);
  });
  it("canal em modo quieto não enfileira (e não gasta a janela de 12 h)", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi!" } });
    await db.update(channels).set({ quietUntil: new Date(night.getTime() + 48 * 3_600_000) }).where(eq(channels.id, chId));
    await lead("71999990212", night);
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990212")))[0].lastAutoReplyAt).toBeNull();
  });
  it("contato ignorado não recebe", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi!" } });
    const id = await lead("71999990221", new Date("2026-10-14T13:00:00Z"));
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, d.contactId));
    await recordInbound({ channelId: chId, externalId: "z1", phoneRaw: "71999990221", body: "oi", at: night });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});

// Formato real da Evolution 2.3.7 (conferido em /evolution/dist/main.js):
//  - voto chega em messages.upsert com messageType "pollUpdateMessage"; a Evolution decifra e troca
//    message.pollUpdateMessage.vote.selectedOptions pelos NOMES das opções e põe data.pollUpdates = [{ name, voters }];
//  - messages.update traz data.keyId (id da enquete) e data.pollUpdates no mesmo formato agregado [{ name, voters }].
describe("confirmação por enquete", () => {
  const POLL = "POLL1";
  const voter = "557199990301@s.whatsapp.net";
  const agg = (chosen: string | null) => ["Confirmo", "Preciso remarcar"].map((name) => ({ name, voters: name === chosen ? [voter] : [] }));
  const upsertVote = (voteId: string, chosen: string | null): EvoPayload => ({
    event: "messages.upsert", instance: "rec",
    data: {
      key: { remoteJid: voter, fromMe: false, id: voteId }, pushName: "Cliente", messageType: "pollUpdateMessage", messageTimestamp: 1_760_000_000,
      message: { pollUpdateMessage: { pollCreationMessageKey: { id: POLL, remoteJid: voter, fromMe: true }, vote: { selectedOptions: chosen ? [chosen] : [] }, senderTimestampMs: 1 }, messageContextInfo: {} },
      pollUpdates: agg(chosen),
    },
  });
  const update = (chosen: string | null): EvoPayload => ({ event: "messages.update", instance: "rec", data: { keyId: POLL, remoteJid: voter, fromMe: true, status: "SERVER_ACK", pollUpdates: agg(chosen) } });
  let d1 = "";
  const poll = async () => {
    d1 = await lead("71999990301", new Date("2026-10-13T13:00:00Z"));
    const [d] = await db.select().from(deals).where(eq(deals.id, d1));
    await db.insert(messages).values({ dealId: d1, contactId: d.contactId, channelId: chId, externalId: POLL, direction: "out", kind: "poll", body: "Enquete: Confirma seu horário?", status: "sent" });
  };
  const att = async () => (await db.select().from(deals).where(eq(deals.id, d1)))[0].attendance;
  const remarcar = async () => (await db.select().from(tasks).where(eq(tasks.dealId, d1))).filter((t) => t.kind === "proxima_acao" && /remarcar/i.test(t.title) && !t.doneAt);

  it("voto em messages.upsert: 'Confirmo' marca confirmado; 'Preciso remarcar' cria 1 tarefa", async () => {
    await poll();
    await ingestEvolution(upsertVote("V1", "Confirmo"));
    expect(await att()).toBe("confirmado");
    await ingestEvolution(upsertVote("V2", "Preciso remarcar"));
    expect(await remarcar()).toHaveLength(1);
    expect(await att()).toBeNull(); // mudou de ideia: deixa de constar como confirmado
    await ingestEvolution(upsertVote("V3", "Preciso remarcar"));
    expect(await remarcar()).toHaveLength(1);
    await ingestEvolution(upsertVote("V4", "Confirmo"));
    expect(await att()).toBe("confirmado");
    expect(await remarcar()).toHaveLength(0); // a tarefa de remarcar sai da lista
  });
  it("voto em messages.update: troca de voto não é descartada como duplicada e o mesmo voto repetido não duplica a tarefa", async () => {
    await poll();
    await ingestEvolution(update("Confirmo"));
    expect(await att()).toBe("confirmado");
    await ingestEvolution(update("Preciso remarcar"));
    expect(await remarcar()).toHaveLength(1);
    const again = await ingestEvolution(update("Preciso remarcar"));
    expect(again).toMatchObject({ duplicate: true });
    expect(await remarcar()).toHaveLength(1);
    // mesmo voto reentregue em outro evento (status diferente, então não é "duplicado" no webhook): o domínio é idempotente
    const redelivered = update("Preciso remarcar"); (redelivered.data as { status?: string }).status = "DELIVERY_ACK";
    await ingestEvolution(redelivered);
    expect((await db.select().from(tasks).where(eq(tasks.dealId, d1))).filter((t) => /remarcar/i.test(t.title))).toHaveLength(1);
  });
  it("voto retirado, enquete desconhecida ou voto de enquete que não é nossa: ignora", async () => {
    await poll();
    await ingestEvolution(upsertVote("V9", null));
    expect(await att()).toBeNull();
    await ingestEvolution({ ...update("Confirmo"), data: { ...(update("Confirmo").data as object), keyId: "OUTRA" } } as EvoPayload);
    expect(await att()).toBeNull();
    // voto de opção que não conhecemos
    await ingestEvolution({ ...upsertVote("V10", null), data: { ...(upsertVote("V10", null).data as object), pollUpdates: [{ name: "Talvez", voters: [voter] }] } } as EvoPayload);
    expect(await att()).toBeNull();
    expect(await remarcar()).toHaveLength(0);
  });
});

describe("fix round 1: resposta fora do horário atrasada", () => {
  const night = new Date("2026-10-14T02:00:00Z"); // ter 23h em Salvador
  const min = (n: number) => new Date(night.getTime() + n * 60_000);
  const setup = async (phone = "71999990401") => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi! A Casa abre às 8h." } });
    return lead(phone, night);
  };
  it("não enfileira se a mensagem já tem mais de 10 min ou se a Casa já abriu", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi!" } });
    await recordInboundReal({ channelId: chId, externalId: "a1", phoneRaw: "71999990402", body: "oi", at: night, now: min(11) });
    await recordInboundReal({ channelId: chId, externalId: "a2", phoneRaw: "71999990403", body: "oi", at: night, now: new Date("2026-10-14T13:00:00Z") });
    expect(await db.select().from(outbox)).toHaveLength(0);
    await recordInboundReal({ channelId: chId, externalId: "a3", phoneRaw: "71999990404", body: "oi", at: night, now: min(9) });
    expect(await db.select().from(outbox)).toHaveLength(1);
  });
  it("sai se ainda é noite e a cliente continua esperando", async () => {
    await setup();
    await drainOutbox(min(5));
    expect(sent).toEqual(["Oi! A Casa abre às 8h."]);
  });
  it("cancela se a Casa abriu, se passou de 30 min ou se a cliente já foi atendida", async () => {
    const id = await setup("71999990411");
    const open = new Date("2026-10-14T12:00:00Z"); // qua 9h
    await drainOutbox(open);
    expect(sent).toHaveLength(0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "cancelled" });

    await db.delete(outbox);
    await db.update(contacts).set({ lastAutoReplyAt: null });
    await db.update(deals).set({ awaitingReplySince: night }).where(eq(deals.id, id));
    await enqueueAutomated({ dealId: id, kind: "text", text: "velha", source: "auto_resposta", guard: { awaitingSince: night }, at: night });
    await drainOutbox(min(31));
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "cancelled" });
    expect(sent).toHaveLength(0);

    await db.delete(outbox);
    await enqueueAutomated({ dealId: id, kind: "text", text: "atendida", source: "auto_resposta", guard: { awaitingSince: night }, at: night });
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, id));
    await drainOutbox(min(5));
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "cancelled" });
    await db.delete(outbox);
    await enqueueAutomated({ dealId: id, kind: "text", text: "outra espera", source: "auto_resposta", guard: { awaitingSince: night }, at: night });
    await db.update(deals).set({ awaitingReplySince: min(2) }).where(eq(deals.id, id));
    await drainOutbox(min(5));
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "cancelled" });
    expect(sent).toHaveLength(0);
  });
});

describe("fix round 1: teto com drains concorrentes", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  it("com o cadeado ocupado o drain não faz nada", async () => {
    const id = await lead("71999990501", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "x" });
    const c = await pool.connect();
    try {
      await c.query("select pg_advisory_lock($1::bigint)", [OUTBOX_LOCK_KEY]);
      expect(await drainOutbox(t0)).toMatchObject({ skipped: true });
      expect(sent).toHaveLength(0);
    } finally { await c.query("select pg_advisory_unlock($1::bigint)", [OUTBOX_LOCK_KEY]); c.release(); }
    await drainOutbox(t0);
    expect(sent).toHaveLength(1);
  });
  it("dois drains ao mesmo tempo respeitam o teto", async () => {
    await db.insert(settings).values({ key: "envio_teto_hora", value: 2 });
    for (const p of ["71999990511", "71999990512", "71999990513", "71999990514"]) await enqueueAutomated({ dealId: await lead(p, t0), kind: "text", text: p });
    await Promise.all([drainOutbox(t0), drainOutbox(t0), drainOutbox(t0)]);
    expect(sent).toHaveLength(2);
  });
  it("item 'enviando' conta no teto", async () => {
    await db.insert(settings).values({ key: "envio_teto_hora", value: 1 });
    const a = await lead("71999990521", t0), b = await lead("71999990522", t0);
    await enqueueAutomated({ dealId: a, kind: "text", text: "em curso" });
    await db.update(outbox).set({ status: "sending", notBefore: new Date(t0.getTime() - 60_000) });
    await enqueueAutomated({ dealId: b, kind: "text", text: "espera" });
    await drainOutbox(t0);
    expect(sent).toHaveLength(0);
  });
});

describe("fix round 1: falha depois de a Evolution enviar", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  it("não reenvia: fica 'sent' com a nota do erro", async () => {
    const id = await lead("71999990601", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "uma vez só" });
    sendHooks.beforeConfirm = async () => { throw new Error("banco caiu"); };
    await drainOutbox(t0);
    expect(sent).toEqual(["uma vez só"]);
    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: "sent", attempts: 1 });
    expect(row.error).toMatch(/banco caiu/);
    sendHooks.beforeConfirm = undefined;
    await drainOutbox(new Date(t0.getTime() + 3_600_000));
    expect(sent).toEqual(["uma vez só"]);
    const out = (await db.select().from(messages).where(eq(messages.dealId, id))).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("sent");
  });
});

describe("fix round 1: lembrete e enquete revalidam o agendamento", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  const sched = new Date(t0.getTime() + 20 * 3_600_000); // qua 6h local
  const prepare = async (key: "enquete" | "texto") => {
    const id = await lead("71999990701", t0);
    await db.update(deals).set({ scheduledAt: sched, stageId: sql`(select id from stages where key = 'agendado')` }).where(eq(deals.id, id));
    await scheduleAutomation(key);
    await runRules(t0);
    expect(await db.select().from(outbox)).toHaveLength(1);
    return id;
  };
  for (const key of ["enquete", "texto"] as const) {
    it(`${key}: sai se nada mudou`, async () => {
      await prepare(key);
      await drainOutbox(new Date(t0.getTime() + 60_000));
      expect(sent).toHaveLength(1);
    });
    it(`${key}: cancela se o agendamento mudou, passou, saiu da etapa ou o lead fechou`, async () => {
      const id = await prepare(key);
      const status = async () => (await db.select().from(outbox))[0];
      await db.update(deals).set({ scheduledAt: new Date(sched.getTime() + 3_600_000) }).where(eq(deals.id, id));
      await drainOutbox(new Date(t0.getTime() + 60_000));
      expect((await status()).status).toBe("cancelled");

      await db.update(outbox).set({ status: "pending", error: null, notBefore: new Date(0) });
      await db.update(deals).set({ scheduledAt: sched }).where(eq(deals.id, id));
      await drainOutbox(new Date("2026-10-14T14:00:00Z")); // depois do horário marcado, Casa aberta
      expect((await status()).status).toBe("cancelled");

      await db.update(outbox).set({ status: "pending", error: null, notBefore: new Date(0) });
      await db.update(deals).set({ stageId: sql`(select id from stages where key = 'atendimento')` }).where(eq(deals.id, id));
      await drainOutbox(new Date(t0.getTime() + 60_000));
      expect((await status()).status).toBe("cancelled");

      await db.update(outbox).set({ status: "pending", error: null, notBefore: new Date(0) });
      await db.update(deals).set({ stageId: sql`(select id from stages where key = 'agendado')`, closedAt: new Date(t0.getTime() + 1000) }).where(eq(deals.id, id));
      await drainOutbox(new Date(t0.getTime() + 60_000));
      expect((await status()).status).toBe("cancelled");
      expect(sent).toHaveLength(0);
    });
  }
});

describe("fix round 1: título da enquete e item preso", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  it("título maior que 255 depois das variáveis é truncado com reticências, sem erro no motor", async () => {
    const id = await lead("71999990801", t0);
    await db.update(contacts).set({ name: "Mariana Souza" }); // sem nome, {nome} some do texto da cliente
    await db.update(deals).set({ scheduledAt: new Date(t0.getTime() + 20 * 3_600_000), stageId: sql`(select id from stages where key = 'agendado')` }).where(eq(deals.id, id));
    await scheduleAutomation("enquete", { message: "{data} {hora} " + "{nome}".repeat(38) });
    const s = await runRules(t0);
    expect(s.errors).toEqual([]);
    const [row] = await db.select().from(outbox);
    expect(row.text).toHaveLength(255);
    expect(row.text.endsWith("…")).toBe(true);
  });
  it("item preso em 'enviando': falha, mensagem da conversa vira 'falhou' e a gestão é avisada", async () => {
    const id = await lead("71999990811", t0);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await enqueueAutomated({ dealId: id, kind: "text", text: "travou" });
    await db.update(outbox).set({ status: "sending", attempts: 1, notBefore: new Date(t0.getTime() - 20 * 60_000) });
    await db.insert(messages).values({ dealId: id, contactId: d.contactId, channelId: chId, direction: "out", kind: "text", body: "travou", status: "pending" });
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0].status).toBe("failed");
    const m = (await db.select().from(messages).where(eq(messages.dealId, id))).find((x) => x.direction === "out")!;
    expect(m).toMatchObject({ status: "failed", error: "Envio automático interrompido" });
    expect((await otherAlerts()).some((a) => a.type === "envio_automatico_falhou" && a.audience === "gestao")).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("fix round 2: envio incerto (a Evolution não respondeu)", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  const cases: [string, () => Error][] = [
    ["AbortError (timeout do fetch)", () => new DOMException("The operation was aborted", "AbortError")],
    ["TypeError de rede (fetch failed)", () => new TypeError("fetch failed")],
    ["ProviderError sem resposta HTTP", () => new ProviderError("O serviço do WhatsApp (Evolution) não respondeu. Ele está ligado?")],
  ];
  for (const [name, make] of cases) {
    it(`${name}: 1 envio, item 'failed', alerta e nenhum retry`, async () => {
      const id = await lead("71999990901", t0);
      await enqueueAutomated({ dealId: id, kind: "text", text: "incerta" });
      failWith = make;
      await drainOutbox(t0);
      let [row] = await db.select().from(outbox);
      expect(row).toMatchObject({ status: "failed", attempts: 1, error: "Envio incerto: a Evolution não respondeu. Confira no WhatsApp antes de reenviar." });
      expect(textCalls).toBe(1);
      expect((await otherAlerts()).some((a) => a.type === "envio_automatico_falhou" && a.audience === "gestao" && a.dealId === id)).toBe(true);
      const m = (await db.select().from(messages).where(eq(messages.dealId, id))).find((x) => x.direction === "out")!;
      expect(m).toMatchObject({ status: "failed" });
      expect((row.options as { messageId?: string }).messageId).toBe(m.id);
      await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
      [row] = await db.select().from(outbox);
      expect(textCalls).toBe(1); expect(row.attempts).toBe(1);
    });
  }
  it("erro com resposta HTTP (4xx/5xx) continua com retry", async () => {
    const id = await lead("71999990902", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "http" });
    failWith = () => new ProviderError("Evolution respondeu 400: número inválido", 400);
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "pending", attempts: 1 });
  });
  it("item preso usa o id da mensagem guardado, não o corpo", async () => {
    const id = await lead("71999990903", t0);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const base = { dealId: id, contactId: d.contactId, channelId: chId, direction: "out", kind: "text", body: "igual", status: "pending" } as const;
    const [mine, other] = await db.insert(messages).values([base, base]).returning();
    await enqueueAutomated({ dealId: id, kind: "text", text: "igual" });
    await db.update(outbox).set({ status: "sending", attempts: 1, notBefore: new Date(t0.getTime() - 20 * 60_000), options: { messageId: mine.id } });
    await drainOutbox(t0);
    const rows = await db.select().from(messages).where(eq(messages.dealId, id));
    expect(rows.find((r) => r.id === mine.id)!.status).toBe("failed");
    expect(rows.find((r) => r.id === other.id)!.status).toBe("pending");
  });
});

describe("fix round 3: fail-closed no retry", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  const one = async (phone = "71999991001") => { const id = await lead(phone, t0); await enqueueAutomated({ dealId: id, kind: "text", text: "uma" }); return id; };
  for (const status of [408, 502, 503, 504]) {
    it(`HTTP ${status} é incerto: failed, 1 envio, alerta, sem retry`, async () => {
      const id = await one();
      failWith = () => new ProviderError(`Evolution respondeu ${status}`, status);
      await drainOutbox(t0);
      expect((await db.select().from(outbox))[0]).toMatchObject({ status: "failed", attempts: 1, error: UNCERTAIN_SEND_MESSAGE });
      expect((await otherAlerts()).some((a) => a.type === "envio_automatico_falhou" && a.dealId === id)).toBe(true);
      await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
      expect(textCalls).toBe(1);
    });
  }
  for (const status of [400, 422, 500]) {
    it(`HTTP ${status} é "não saiu": tenta de novo`, async () => {
      await one();
      failWith = () => new ProviderError(`Evolution respondeu ${status}`, status);
      await drainOutbox(t0);
      expect((await db.select().from(outbox))[0]).toMatchObject({ status: "pending", attempts: 1 });
    });
  }
  it("erro desconhecido (nem HTTP nem rede): failed com alerta, sem retry", async () => {
    await one();
    failWith = () => new Error("boom inesperado");
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "failed", attempts: 1 });
    await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
    expect(textCalls).toBe(1);
  });
  it("erro de banco ao marcar a mensagem no caminho incerto não gera retry", async () => {
    const id = await one("71999991002");
    await db.execute(sql`create or replace function t12_fail() returns trigger as $$ begin raise exception 'banco caiu'; end $$ language plpgsql`);
    await db.execute(sql`create trigger t12_trg before update on messages for each row when (new.status = 'failed') execute function t12_fail()`);
    failWith = () => new DOMException("aborted", "AbortError");
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "failed", attempts: 1, error: UNCERTAIN_SEND_MESSAGE });
    expect((await otherAlerts()).some((a) => a.dealId === id && a.type === "envio_automatico_falhou")).toBe(true);
    await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
    expect(textCalls).toBe(1);
  });
});

describe("fix round 3: eco x timeout", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  const echo = (phone: string, id: string, text: string) => ingestEvolution({ event: "send.message", instance: "rec", data: { key: { remoteJid: `55${phone}@s.whatsapp.net`, fromMe: true, id }, message: { conversation: text }, messageTimestamp: 1 } });
  it("eco chega antes do timeout: entregue, item 'sent', sem alerta, 1 bolha", async () => {
    const id = await lead("71999991101", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "chegou" });
    failWith = () => new DOMException("aborted", "AbortError");
    beforeFail = async () => { await echo("7199991101", "ECO1", "chegou"); };
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "sent" });
    expect(await otherAlerts()).toHaveLength(0);
    const out = (await db.select().from(messages).where(eq(messages.dealId, id))).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "sent", externalId: "ECO1", error: null });
  });
  for (const last of [false, true]) {
    it(`400 explícito com o eco já recebido${last ? " (última tentativa)" : ""}: entregue, 1 envio, item 'sent', sem retry`, async () => {
      const id = await lead("71999991105", t0);
      await enqueueAutomated({ dealId: id, kind: "text", text: "saiu mesmo assim" });
      if (last) await db.update(outbox).set({ attempts: 2 });
      // Evolution 2.x responde 400 para erros que acontecem DEPOIS do envio pelo Baileys.
      failWith = () => new ProviderError("Evolution respondeu 400: erro depois do envio", 400);
      beforeFail = async () => { await echo("7199991105", "ECO5", "saiu mesmo assim"); };
      await drainOutbox(t0);
      expect((await db.select().from(outbox))[0]).toMatchObject({ status: "sent" });
      const out = (await db.select().from(messages).where(eq(messages.dealId, id))).filter((m) => m.direction === "out");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ status: "sent", externalId: "ECO5", error: null });
      expect(await otherAlerts()).toHaveLength(0);
      await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
      expect(textCalls).toBe(1);
    });
  }
  it("eco depois do incerto promove a linha: 1 bolha 'sent', item 'sent', alerta resolvido, sem virar resposta humana", async () => {
    const id = await lead("71999991102", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "tardia" });
    failWith = () => new DOMException("aborted", "AbortError");
    await drainOutbox(t0);
    expect((await db.select().from(outbox))[0].status).toBe("failed");
    const before = (await db.select().from(deals).where(eq(deals.id, id)))[0];
    expect(before.awaitingReplySince).not.toBeNull();
    await echo("7199991102", "ECO2", "tardia");
    const out = (await db.select().from(messages).where(eq(messages.dealId, id))).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "sent", externalId: "ECO2", error: null });
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "sent", error: null });
    const al = (await otherAlerts()).filter((a) => a.type === "envio_automatico_falhou");
    expect(al).toHaveLength(1); expect(al[0].resolvedAt).not.toBeNull();
    const after = (await db.select().from(deals).where(eq(deals.id, id)))[0];
    expect(after.awaitingReplySince?.getTime()).toBe(before.awaitingReplySince?.getTime());
    expect(after.firstResponseAt).toBeNull();
    expect((await db.select().from(dealEvents).where(eq(dealEvents.dealId, id))).some((e) => e.type === "resposta")).toBe(false);
    expect(after.lastOutboundAt).not.toBeNull(); // conta como envio automático, como qualquer outro
  });
  it("linha 'failed' por outro erro não é promovida", async () => {
    const id = await lead("71999991103", t0);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const [failed] = await db.insert(messages).values({ dealId: id, contactId: d.contactId, channelId: chId, direction: "out", kind: "text", body: "outra", status: "failed", error: "Evolution respondeu 500" }).returning();
    await echo("7199991103", "ECO3", "outra");
    const row = (await db.select().from(messages).where(eq(messages.id, failed.id)))[0];
    expect(row).toMatchObject({ status: "failed", externalId: null });
  });
  it("pending vence a linha 'failed' incerta", async () => {
    const id = await lead("71999991104", t0);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const base = { dealId: id, contactId: d.contactId, channelId: chId, direction: "out", kind: "text", body: "igual" } as const;
    const [fail, pend] = await db.insert(messages).values([{ ...base, status: "failed", error: UNCERTAIN_SEND_MESSAGE }, { ...base, status: "pending" }]).returning();
    await echo("7199991104", "ECO4", "igual");
    const rows = await db.select().from(messages).where(eq(messages.dealId, id));
    expect(rows.find((r) => r.id === pend.id)).toMatchObject({ status: "sent", externalId: "ECO4" });
    expect(rows.find((r) => r.id === fail.id)).toMatchObject({ status: "failed", externalId: null });
  });
});

describe("erro inesperado no processamento do item", () => {
  const t0 = new Date("2026-10-13T13:00:00Z");
  const quiet = async <T>(fn: () => Promise<T>) => { const errs: unknown[][] = []; const orig = console.error; console.error = (...a: unknown[]) => { errs.push(a); }; try { return { r: await fn(), errs }; } finally { console.error = orig; } };
  it("depois do envio (registro do item falhou): loga, item 'failed', alerta 'envio incerto — confira no WhatsApp', sem reenvio", async () => {
    const id = await lead("71999991201", t0);
    const itemId = await enqueueAutomated({ dealId: id, kind: "text", text: "saiu" });
    await db.execute(sql`create or replace function t27_fail() returns trigger as $$ begin raise exception 'banco caiu no registro'; end $$ language plpgsql`);
    await db.execute(sql`create trigger t27_trg before update on outbox for each row when (new.status = 'sent') execute function t27_fail()`);
    try {
      const { errs } = await quiet(() => drainOutbox(t0));
      expect(errs.length).toBeGreaterThan(0);
    } finally { await db.execute(sql`drop trigger if exists t27_trg on outbox`); }
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "failed" });
    const al = (await otherAlerts()).filter((a) => a.dedupeKey === `auto:${itemId}`);
    expect(al).toHaveLength(1);
    expect(al[0]).toMatchObject({ type: "envio_automatico_falhou", audience: "gestao", dealId: id });
    expect(al[0].message).toMatch(/envio incerto\. Confira no WhatsApp/);
    await drainOutbox(new Date(t0.getTime() + 3 * 3_600_000));
    expect(textCalls).toBe(1);
  });
  it("erro de banco antes de chamar o provider (nada saiu): loga e tenta de novo depois, sem alerta de envio incerto", async () => {
    const id = await lead("71999991202", t0);
    await enqueueAutomated({ dealId: id, kind: "text", text: "não saiu" });
    await db.execute(sql`create or replace function t27_fail() returns trigger as $$ begin raise exception 'banco caiu antes'; end $$ language plpgsql`);
    await db.execute(sql`create trigger t27_trg before insert on messages for each row when (new.direction = 'out') execute function t27_fail()`);
    try {
      const { errs } = await quiet(() => drainOutbox(t0));
      expect(errs.flat().join(" ")).toMatch(/banco caiu antes/);
    } finally { await db.execute(sql`drop trigger if exists t27_trg on messages`); }
    expect(textCalls).toBe(0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(await otherAlerts()).toHaveLength(0);
    await drainOutbox(new Date(t0.getTime() + 6 * 60_000));
    expect(sent).toEqual(["não saiu"]);
  });
});
