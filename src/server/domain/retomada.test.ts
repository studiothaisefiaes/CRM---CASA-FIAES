import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, outbox, settings, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound, moveDealTx } from "./deals";
import { drainOutbox } from "./outbox";
import { remindDueTasks } from "./tasks";
import { bulkResume, cancelPendingMessages, cancelResume, doneResume, resume, sendResumeNow } from "./retomada";
import { scheduleMessage } from "./scheduled";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { fillFirstName } from "../../lib/retomada";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN }; // ter–sáb 9h–18h
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10:00 em Salvador
const AT = new Date("2026-10-14T13:00:00Z"); // quarta 10:00
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: `OUT${sent.length}` }; },
};
let sara = "", dealId = "", ch = "";
const openTask = async (id = dealId) => (await db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))))[0];
const pendings = () => db.select().from(outbox).where(eq(outbox.status, "pending"));
const deal = async (id = dealId) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

async function conversa(phone: string, name: string) {
  const r = await recordInbound({ channelId: ch, externalId: `IN-${phone}`, phoneRaw: phone, pushName: name, body: "Quanto custa a escova?", at: plus(T0, -10), now: plus(T0, -10) });
  if (!("dealId" in r)) throw new Error("sem conversa");
  await db.update(deals).set({ ownerId: sara }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: ch, body: "R$ 80", userId: sara, at: plus(T0, -5) });
  return r.dealId;
}

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  [{ id: ch }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  dealId = await conversa("71999990031", "Juliana Pires");
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

describe("Retomada: uma ação só (lembrete ou mensagem programada)", () => {
  it("sem mensagem: vira lembrete (a próxima ação) e a conversa espera a cliente com as tentativas", async () => {
    const r = await resume(dealId, { dueAt: AT, motivo: "Ver se ela decidiu" }, sara, T0);
    expect(r.outboxId).toBeNull();
    expect(await openTask()).toMatchObject({ title: "Ver se ela decidiu", dueAt: AT, assigneeId: sara });
    expect(await deal()).toMatchObject({ followupAttempt: 1, awaitingReplySince: null });
    expect(await pendings()).toHaveLength(0);
  });

  it("com mensagem: programa a mensagem (com o 1º nome) ligada à retomada; o lembrete não avisa enquanto ela vai sair; saiu → a retomada conta como feita", async () => {
    const r = await resume(dealId, { dueAt: AT, texto: "Oi, {primeiro_nome}! Conseguiu ver os horários?" }, sara, T0);
    const [o] = await pendings();
    expect(o).toMatchObject({ id: r.outboxId, text: "Oi, Juliana! Conseguiu ver os horários?", notBefore: AT });
    expect((o.options as { taskId?: string }).taskId).toBe(r.taskId);
    expect((await openTask()).title).toBe("Mensagem programada");
    expect((await remindDueTasks(plus(AT, 1))).alerts).toBe(0);
    await drainOutbox(plus(AT, 1));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Conseguiu ver os horários?");
    expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId!)))[0].doneAt).not.toBeNull();
  });

  it("'Cancelar se ela responder antes': ela escreveu → a mensagem não sai e a retomada é cancelada", async () => {
    const r = await resume(dealId, { dueAt: AT, texto: "Oi! Ainda tem interesse?", cancelIfReply: true }, sara, T0);
    await recordInbound({ channelId: ch, externalId: "IN-volta", phoneRaw: "71999990031", body: "Oi, quero marcar sábado", at: plus(T0, 30), now: plus(T0, 30) });
    await drainOutbox(plus(AT, 1));
    expect(sent).toHaveLength(0);
    expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId!)))[0].doneAt).not.toBeNull();
  });

  it("Trocar: a retomada nova substitui a de antes e a mensagem antiga não sai mais", async () => {
    await resume(dealId, { dueAt: AT, texto: "Primeira" }, sara, T0);
    await resume(dealId, { dueAt: plus(AT, 60), texto: "Segunda" }, sara, plus(T0, 1));
    expect((await pendings()).map((o) => o.text)).toEqual(["Segunda"]);
    expect(await db.select().from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt)))).toHaveLength(1);
  });

  it("Casa fechada: programa do mesmo jeito (16/10); hora que não dá: erro claro e nada fica pela metade", async () => {
    await resume(dealId, { dueAt: new Date("2026-10-18T13:00:00Z"), texto: "Domingo?" }, sara, T0);
    expect((await pendings()).map((o) => o.text)).toEqual(["Domingo?"]);
    await expect(resume(dealId, { dueAt: plus(T0, 1), texto: "Já já" }, sara, T0)).rejects.toThrow("5 minutos");
    expect((await pendings()).map((o) => o.text)).toEqual(["Domingo?"]);
    expect(await openTask()).toBeDefined();
  });

  it("Feito, Cancelar e Enviar agora", async () => {
    await resume(dealId, { dueAt: AT, texto: "Oi!" }, sara, T0);
    await doneResume(dealId, sara, plus(T0, 2));
    expect(await openTask()).toBeUndefined();
    expect(await pendings()).toHaveLength(0);

    await resume(dealId, { dueAt: AT, motivo: "Ligar" }, sara, plus(T0, 3));
    await cancelResume(dealId, sara, plus(T0, 4));
    expect(await openTask()).toBeUndefined();
    expect((await deal()).followupAttempt).toBe(0);

    const r = await resume(dealId, { dueAt: AT, texto: "Já mando agora" }, sara, plus(T0, 5));
    await sendResumeNow(r.outboxId!, sara, plus(T0, 6));
    expect(sent).toEqual([expect.stringContaining("Já mando agora")]);
    expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId!)))[0].doneAt).not.toBeNull();
  });

  it("Agendado: só o lembrete (com a mensagem, se tiver); a etapa não muda", async () => {
    await db.transaction((tx) => moveDealTx(tx, dealId, "agendado", null, "teste", T0));
    await resume(dealId, { dueAt: AT, texto: "Confirmando seu horário!" }, sara, plus(T0, 1));
    const [s] = await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    expect(s.key).toBe("agendado");
    expect(await pendings()).toHaveLength(1);
  });

  it("em lote: a mesma retomada para várias, 1º nome de cada, 1 a cada 20 s; quem falha não derruba as outras", async () => {
    const b = await conversa("71999990032", "Larissa Andrade");
    const r = await bulkResume([dealId, b, "00000000-0000-0000-0000-000000000000"], { dueAt: AT, texto: "Oi, {primeiro_nome}!" }, sara, T0);
    expect(r.ok).toBe(2);
    expect(r.failed).toHaveLength(1);
    const ps = (await pendings()).sort((x, y) => x.notBefore.getTime() - y.notBefore.getTime());
    expect(ps.map((o) => [o.text, o.notBefore.getTime() - AT.getTime()])).toEqual([["Oi, Juliana!", 0], ["Oi, Larissa!", 20_000]]);
    expect(await db.select().from(alerts)).toBeDefined();
  });
});

it("{primeiro_nome}: 1º nome em Título; sem nome, some com a vírgula", () => {
  expect(fillFirstName("Oi, {primeiro_nome}! Tudo bem?", "JULIANA PIRES")).toBe("Oi, Juliana! Tudo bem?");
  expect(fillFirstName("Oi, {primeiro_nome}!", "+5571999990000")).toBe("Oi!");
  expect(fillFirstName("Oi, {primeiro_nome}!", null)).toBe("Oi!");
});

describe("Resolver ou Perdido com mensagem programada (P5): Cancelar", () => {
  it("cancela todas as programadas pendentes da cliente e a retomada ligada a elas; nada sai depois", async () => {
    const r = await resume(dealId, { dueAt: AT, texto: "Oi! Conseguiu ver?" }, sara, T0);
    await scheduleMessage({ dealId, text: "Solta", at: plus(AT, 60) }, sara, T0);
    expect(await pendings()).toHaveLength(2);
    expect(await cancelPendingMessages(dealId, sara)).toBe(2);
    expect(await pendings()).toHaveLength(0);
    expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId!)))[0].doneAt).not.toBeNull();
    expect((await drainOutbox(plus(AT, 90))).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it("sem programada: não faz nada", async () => {
    expect(await cancelPendingMessages(dealId, sara)).toBe(0);
  });
});
