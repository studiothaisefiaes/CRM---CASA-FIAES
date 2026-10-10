import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { automations, channels, contacts, settings, outbox, deals, tasks, messages, alerts, users } from "../db/schema";
import { enqueueAutomated, drainOutbox } from "./outbox";
import { recordInbound } from "./deals";
import { archiveDeals } from "./archive";
import { ingestEvolution, type EvoPayload } from "../whatsapp/webhook";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { runRules } from "../rules/engine";
import { resetDb } from "../../../test/db";

// Provider falso: nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
let failNext = 0;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { if (failNext > 0) { failNext--; throw new Error("Evolution fora do ar"); } sent.push(text); return { externalId: "OUT" + sent.length }; },
  sendPoll: async (_i: string, _to: string, name: string, options: string[]) => { sent.push("poll:" + name + ":" + options.join("|")); return { externalId: "POLL1" }; },
};
let chId = "";
const lead = async (phone: string, at: Date) => { const r = await recordInbound({ channelId: chId, externalId: phone + at.getTime(), phoneRaw: phone, body: "oi", at }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
beforeEach(async () => {
  sent.length = 0; failNext = 0; await resetDb(); setWhatsappProvider(fake);
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});
afterEach(() => setWhatsappProvider(null));

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
  it("sem a configuração, o teto padrão é 20 por hora", async () => {
    for (let i = 0; i < 22; i++) await enqueueAutomated({ dealId: await lead("719999902" + String(i).padStart(2, "0"), t0), kind: "text", text: "m" + i });
    await drainOutbox(t0);
    expect(sent).toHaveLength(20);
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
    const [auto] = await db.select().from(automations).where(eq(automations.key, "lembrete_agendamento"));
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
    expect((await db.select().from(alerts)).some((a) => a.type === "envio_automatico_falhou")).toBe(true);
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
  it("confirmacao_d1 vem desligada; ligada, enfileira a enquete 1 vez e a fila envia", async () => {
    const [auto] = await db.select().from(automations).where(eq(automations.key, "confirmacao_d1"));
    expect(auto.enabled).toBe(false);
    const id = await lead("71999990161", t0);
    await db.execute(`update deals set scheduled_at = '${new Date(t0.getTime() + 20 * 3_600_000).toISOString()}', stage_id = (select id from stages where key = 'agendado') where id = '${id}'` as never);
    await runRules(t0);
    expect(await db.select().from(outbox)).toHaveLength(0);
    await db.update(automations).set({ enabled: true }).where(eq(automations.key, "confirmacao_d1"));
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
