import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { markProposalSent, markWaitingForClient } from "./funnel";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h
const later = (min: number) => new Date(T0.getTime() + min * 60_000);
let ana = "";
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function conversa() {
  const r = await recordInbound({ channelId: null, externalId: "W1", phoneRaw: "71988887777", pushName: "Rita", body: "Quanto custa?", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "R$ 150", at: later(1) });
  await recordInbound({ channelId: null, externalId: "W2", phoneRaw: "71988887777", body: "vou ver com meu marido e te falo", at: later(2) });
  return r.dealId;
}

describe("Esperar a cliente (Retomar sem data: as tentativas correm em Em conversa)", () => {
  it("automático: continua em Em conversa com a tentativa 1 em D+1, sai da espera e os avisos se resolvem", async () => {
    const id = await conversa();
    await db.insert(alerts).values({ dealId: id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "w1", level: 1 });
    const r = await markWaitingForClient(id, {}, ana, later(3));
    expect(r.dueAt.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(await stageOf(id)).toBe("atendimento");
    expect(await dealOf(id)).toMatchObject({ awaitingReplySince: null, followupAttempt: 1, stageEnteredAt: later(3) });
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, id), isNull(alerts.resolvedAt)))).toHaveLength(0);
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, id), eq(dealEvents.type, "aguardando_cliente")));
    expect(ev[0].payload).toMatchObject({ automatico: true, etapaAntes: "atendimento" });
  });

  it("com 'retomar em': a tentativa 1 é na data e com o título escolhidos", async () => {
    const id = await conversa();
    const due = new Date("2026-10-20T13:00:00Z");
    await markWaitingForClient(id, { resumeAt: due, title: "Ela vai falar com o marido" }, ana, later(3));
    const [t] = await openTasks(id);
    expect(t).toMatchObject({ title: "Ela vai falar com o marido", dueAt: due });
  });

  it("já esperando a cliente: sem data recusa; com data só muda a data da tentativa atual", async () => {
    const id = await conversa();
    await markWaitingForClient(id, {}, ana, later(3));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já está esperando a cliente");
    await markWaitingForClient(id, { resumeAt: new Date("2026-10-22T13:00:00Z") }, ana, later(5));
    const d = await dealOf(id);
    expect(d.followupAttempt).toBe(1);
    expect((await openTasks(id)).map((t) => [t.title, t.dueAt.toISOString()])).toEqual([["Tentativa 1 de 3: retomar contato com Rita", "2026-10-22T13:00:00.000Z"]]);
  });

  it("Novo contato: vai para Em conversa com as tentativas (nunca para a antiga Aguardando cliente)", async () => {
    const r = await recordInbound({ channelId: null, externalId: "N1", phoneRaw: "71988880000", pushName: "Bia", body: "Oi", at: T0 });
    if (!("dealId" in r)) throw new Error("sem lead");
    expect(await stageOf(r.dealId)).toBe("lead");
    await markWaitingForClient(r.dealId, { resumeAt: new Date("2026-10-15T13:00:00Z"), title: "Ver se ela mandou a foto" }, ana, later(3));
    expect(await stageOf(r.dealId)).toBe("atendimento");
    expect((await dealOf(r.dealId)).followupAttempt).toBe(1);
    expect((await openTasks(r.dealId)).map((t) => t.title)).toEqual(["Ver se ela mandou a foto"]);
  });

  it("a cliente escreveu de verdade: as tentativas param (contador zera, a tentativa aberta é cancelada) e ela segue em Em conversa", async () => {
    const id = await conversa();
    await markWaitingForClient(id, {}, ana, later(3));
    await recordInbound({ channelId: null, externalId: "W3", phoneRaw: "71988887777", body: "obrigada", at: later(4) });
    expect((await dealOf(id)).followupAttempt).toBe(1); // "obrigada" sozinho não conta
    await recordInbound({ channelId: null, externalId: "W4", phoneRaw: "71988887777", body: "Pode ser sábado às 10?", at: later(5) });
    expect(await stageOf(id)).toBe("atendimento");
    expect(await dealOf(id)).toMatchObject({ followupAttempt: 0, followupTaskId: null, followupDueAt: null });
    expect(await openTasks(id)).toHaveLength(0);
  });

  it("entrar em Em conversa por outro caminho (ex.: voltou de Agendado) não começa tentativa", async () => {
    const id = await conversa();
    await db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "teste", later(3)));
    await db.transaction((tx) => moveDealTx(tx, id, "atendimento", null, "teste", later(4)));
    expect((await dealOf(id)).followupAttempt).toBe(0);
    expect(await openTasks(id)).toHaveLength(0);
  });

  it("Agendado: não sai da etapa; pede a data e cria só o lembrete", async () => {
    const id = await conversa();
    await db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "teste", later(3)));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já tem horário");
    await markWaitingForClient(id, { resumeAt: new Date("2026-10-16T13:00:00Z") }, ana, later(4));
    expect(await stageOf(id)).toBe("agendado");
    expect((await openTasks(id))[0].title).toBe("Retomar contato com Rita");
  });

  it("conversa que já terminou (atendida ou perdida): erro claro", async () => {
    const id = await conversa();
    await db.transaction((tx) => moveDealTx(tx, id, "perdido", null, "teste", later(3)));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já terminou");
  });
});

describe("Enviei orçamento", () => {
  it("vai para Orçamento, retomada em 2 dias, sai da espera", async () => {
    const id = await conversa();
    const r = await markProposalSent(id, ana, later(3));
    expect(await stageOf(id)).toBe("orcamento");
    expect(r.dueAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect((await dealOf(id)).awaitingReplySince).toBeNull();
  });

  it("de quem já esperava a cliente: recomeça as tentativas no ritmo do orçamento; de Agendado ou já em Orçamento: recusa", async () => {
    const id = await conversa();
    await markWaitingForClient(id, {}, ana, later(3));
    await markProposalSent(id, ana, later(4));
    expect((await openTasks(id)).map((t) => t.title)).toEqual(["Tentativa 1 de 3: retomar contato com Rita"]);
    await expect(markProposalSent(id, ana, later(5))).rejects.toThrow("Já está em Orçamento");
    await db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "teste", later(6)));
    await expect(markProposalSent(id, ana, later(7))).rejects.toThrow("já tem horário");
  });
});
