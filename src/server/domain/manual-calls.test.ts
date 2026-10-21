import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, contactNotes, dealEvents, deals, messages, outbox, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { markIncomingCall, registerOutgoingCall } from "./manual-calls";
import { getQueueItem } from "../queries/queue";

const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00 em Salvador
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let sara = "", dealId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990061", pushName: "Cliente Teste", body: "Qual o valor da escova?", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  await db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Cliente Teste espera resposta", dedupeKey: "w1", waitKey: `${dealId}:${T0.toISOString()}` });
});
const deal = async () => (await db.select().from(deals).where(eq(deals.id, dealId)))[0];
const msg = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];
const stageKey = async () => (await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].key;

describe("Registrar ligação feita pela Casa (o WhatsApp não avisa ligação feita pelo celular)", () => {
  it("atendeu: item da conversa 'Ligação feita · atendida', autora quem registrou, a nota junto; conta como contato da Casa", async () => {
    const r = await registerOutgoingCall({ dealId, outcome: "atendeu", durationMin: 4, subject: "Agendamento", note: "marcou escova sábado 10h" }, sara, plus(20));
    const m = await msg(r.messageId);
    expect(m).toMatchObject({ direction: "out", kind: "call", body: "Ligação feita · atendida · 4 min", sentByUserId: sara, externalId: null, dealId });
    expect(m.call).toMatchObject({ status: "atendida", video: false, durationSecs: 240, manual: true });
    // A cliente deixa de esperar (mesma regra da resposta da Casa): espera, avisos, etapa Lead → Em conversa, dona.
    const d = await deal();
    expect(d).toMatchObject({ awaitingReplySince: null, lastOutboundAt: plus(20), firstResponseAt: plus(20), ownerId: sara });
    expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
    expect(await stageKey()).toBe("atendimento");
    expect((await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resposta")))).length).toBe(1);
    // A anotação fica ligada à ligação.
    const notes = await db.select().from(contactNotes).where(eq(contactNotes.messageId, r.messageId));
    expect(notes.map((n) => [n.subject, n.body, n.authorId])).toEqual([["Agendamento", "marcou escova sábado 10h", sara]]);
    // Nada pelo WhatsApp: nem outbox nem envio.
    expect(await db.select().from(outbox)).toHaveLength(0);
    // Audit log.
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "registrou_ligacao"));
    expect(a).toMatchObject({ userId: sara, entity: "deal", entityId: dealId, data: { messageId: r.messageId, resultado: "atendeu", duracaoMin: 4, comNota: true } });
    // Prévia da Fila.
    expect((await getQueueItem(dealId))?.lastMessage).toBe("Ligação feita · atendida · 4 min · Agendamento");
  });

  it("não atendeu: registra 'Ligação feita · não atendida' e a cliente continua esperando (não é resposta)", async () => {
    const r = await registerOutgoingCall({ dealId, outcome: "nao_atendeu" }, sara, plus(20));
    const m = await msg(r.messageId);
    expect(m).toMatchObject({ direction: "out", kind: "call", body: "Ligação feita · não atendida", sentByUserId: sara });
    expect(m.call).toMatchObject({ status: "perdida", manual: true });
    const d = await deal();
    expect(d).toMatchObject({ awaitingReplySince: T0, lastOutboundAt: null, firstResponseAt: null });
    expect((await db.select().from(alerts))[0].resolvedAt).toBeNull();
    expect(await stageKey()).toBe("lead");
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect((await getQueueItem(dealId))?.lastMessage).toBe("Ligação feita · não atendida");
  });

  it("caixa postal/ocupado: não atendida, guardado no registro", async () => {
    const r = await registerOutgoingCall({ dealId, outcome: "ocupado" }, sara, plus(20));
    const m = await msg(r.messageId);
    expect(m.body).toBe("Ligação feita · não atendida");
    expect(m.call).toMatchObject({ status: "perdida", busy: true });
    expect((await deal()).awaitingReplySince).toEqual(T0);
  });

  it("atendeu sem dizer o que foi falado é recusado (e nada é gravado)", async () => {
    await expect(registerOutgoingCall({ dealId, outcome: "atendeu", note: "  " }, sara, plus(5))).rejects.toThrow(/o que foi falado/i);
    await expect(registerOutgoingCall({ dealId, outcome: "atendeu", note: "x", durationMin: 0 }, sara, plus(5))).rejects.toThrow(/duração/i);
    expect((await db.select().from(messages).where(eq(messages.kind, "call")))).toHaveLength(0);
  });
});

describe("Ligação recebida sem resultado ('recebida'): marcar à mão", () => {
  let callId = "";
  beforeEach(async () => {
    // A cliente liga (o WhatsApp não diz se atenderam no celular): entra como "recebida" e abre a espera.
    await db.update(deals).set({ awaitingReplySince: null, lastOutboundAt: plus(-5) }).where(eq(deals.id, dealId));
    await db.update(alerts).set({ resolvedAt: plus(-5) });
    const r = await recordInbound({ channelId: null, externalId: "call:X1", phoneRaw: "71999990061", kind: "call", body: "Ligação recebida", at: plus(10), now: plus(10) });
    if (!("messageId" in r)) throw new Error("sem ligação");
    callId = r.messageId;
    await db.update(messages).set({ call: { video: false, status: "recebida" } }).where(eq(messages.id, callId));
    await db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "espera", dedupeKey: "w2", waitKey: `${dealId}:${plus(10).toISOString()}` });
    expect((await deal()).awaitingReplySince).toEqual(plus(10));
  });

  it("Foi atendida: rótulo 'Ligação recebida · atendida' e a espera sai; Desfazer devolve a espera", async () => {
    const r = await markIncomingCall({ messageId: callId, status: "atendida" }, sara, plus(15));
    expect(r).toMatchObject({ changed: true, previous: "recebida", status: "atendida" });
    const m = await msg(callId);
    expect(m.body).toBe("Ligação recebida · atendida");
    expect(m.call).toMatchObject({ status: "atendida", marked: { by: sara, prevAwaitingSince: plus(10).toISOString() } });
    expect((await deal()).awaitingReplySince).toBeNull();
    expect((await db.select().from(alerts).where(eq(alerts.dedupeKey, "w2")))[0].resolvedAt).not.toBeNull();
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "marcou_ligacao"));
    expect(a).toMatchObject({ userId: sara, entity: "message", entityId: callId, data: { dealId, de: "recebida", para: "atendida" } });

    await markIncomingCall({ messageId: callId, status: "recebida" }, sara, plus(16));
    expect((await msg(callId)).body).toBe("Ligação recebida");
    expect((await msg(callId)).call).toMatchObject({ status: "recebida", marked: null });
    expect((await deal()).awaitingReplySince).toEqual(plus(10));
  });

  it("Foi perdida: 'Ligação perdida' e a cliente continua esperando retorno; trocar depois para atendida tira a espera", async () => {
    await markIncomingCall({ messageId: callId, status: "perdida" }, sara, plus(15));
    expect((await msg(callId)).body).toBe("Ligação perdida");
    expect((await deal()).awaitingReplySince).toEqual(plus(10));
    await markIncomingCall({ messageId: callId, status: "atendida" }, sara, plus(16));
    expect((await deal()).awaitingReplySince).toBeNull();
    // E de volta para perdida: a espera volta.
    await markIncomingCall({ messageId: callId, status: "perdida" }, sara, plus(17));
    expect((await deal()).awaitingReplySince).toEqual(plus(10));
  });

  it("atendida não tira a espera de mensagem que a cliente escreveu depois da ligação", async () => {
    await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71999990061", body: "E aí, conseguiu ver?", at: plus(12), now: plus(12) });
    await markIncomingCall({ messageId: callId, status: "atendida" }, sara, plus(15));
    expect((await deal()).awaitingReplySince).toEqual(plus(10));
  });

  it("voltar de atendida não reabre a espera se a Casa já respondeu depois", async () => {
    await markIncomingCall({ messageId: callId, status: "atendida" }, sara, plus(15));
    await recordOutbound({ dealId, channelId: null, body: "Qualquer coisa me chama", userId: sara, at: plus(20) });
    await markIncomingCall({ messageId: callId, status: "perdida" }, sara, plus(25));
    expect((await deal()).awaitingReplySince).toBeNull();
  });

  it("ligação que já veio com resultado do WhatsApp não é marcada à mão; ligação feita também não", async () => {
    await db.update(messages).set({ call: { video: false, status: "atendida", durationSecs: 60 } }).where(eq(messages.id, callId));
    await expect(markIncomingCall({ messageId: callId, status: "perdida" }, sara, plus(15))).rejects.toThrow(/resultado/i);
    const out = await registerOutgoingCall({ dealId, outcome: "nao_atendeu" }, sara, plus(20));
    await expect(markIncomingCall({ messageId: out.messageId, status: "atendida" }, sara, plus(21))).rejects.toThrow();
  });
});
