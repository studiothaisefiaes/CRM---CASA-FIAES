import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, salesItems, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { closeAttendedDeals, markWaitingForClient } from "./funnel";
import { archiveConversation } from "./conversation-archive";
import { markAttendance } from "./updates";

const T0 = new Date("2026-10-13T13:00:00Z");
let ana = "";
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const openTitles = async (id: string) => (await db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)))).map((t) => t.title);

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function lead(phone = "71988885555") {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}`, phoneRaw: phone, pushName: "Rita Souza", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  return r.dealId;
}
const toStage = (id: string, key: string, at = T0) => db.transaction((tx) => moveDealTx(tx, id, key, null, "teste", at));

describe("títulos dos combinados", () => {
  it("nome em Título e, sem nome, o telefone formatado (Remarcar e Conferir se compareceu)", async () => {
    const r = await recordInbound({ channelId: null, externalId: "L-caps", phoneRaw: "71977776666", pushName: "ÚRSULA DUARTE", body: "oi", at: T0 });
    if (!("dealId" in r)) throw new Error("sem lead");
    await toStage(r.dealId, "agendado");
    await markAttendance(r.dealId, "faltou", ana);
    expect(await openTitles(r.dealId)).toEqual(["Remarcar com Úrsula Duarte"]);
    const { scheduleDeal } = await import("./updates");
    const sem = await recordInbound({ channelId: null, externalId: "L-sem", phoneRaw: "71990000002", pushName: null, body: "oi", at: T0 });
    if (!("dealId" in sem)) throw new Error("sem lead");
    await scheduleDeal(sem.dealId, "2026-10-20T13:00:00Z", ana, T0);
    const titles = (await db.select().from(tasks).where(and(eq(tasks.dealId, sem.dealId), eq(tasks.kind, "comparecimento")))).map((t) => t.title);
    expect(titles).toEqual(["Conferir se (71) 99000-0002 veio"]);
  });
});

describe("Atendida", () => {
  it("Compareceu: vai para Atendida com o pós-atendimento (agradecer, foto, avaliação) para a dona", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    await markAttendance(id, "compareceu", ana);
    expect(await stageOf(id)).toBe("atendida");
    expect(await openTitles(id)).toEqual(["Pós-atendimento de Rita: agradecer, pedir foto e avaliação"]);
  });

  it("Faltou: Em conversa esperando a cliente, com o Remarcar como tentativa 1", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    expect(await markAttendance(id, "faltou", ana)).toEqual({ changed: true, remarcar: true });
    expect(await stageOf(id)).toBe("atendimento");
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const [t] = await db.select().from(tasks).where(eq(tasks.id, d.followupTaskId!));
    expect(t.title).toMatch(/^Remarcar com /);
    expect(d.followupAttempt).toBe(1);
  });

  it("corrigir Compareceu → Faltou: o pós-atendimento é cancelado e entra o Remarcar", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    await markAttendance(id, "compareceu", ana);
    await markAttendance(id, "faltou", ana);
    expect(await stageOf(id)).toBe("atendimento");
    expect((await openTitles(id))[0]).toMatch(/^Remarcar com /);
    expect((await openTitles(id)).some((t) => t.startsWith("Pós-atendimento"))).toBe(false);
  });

  it("3 dias depois termina sozinha em Atendida (sem a antiga etapa Fechado): encerrada e com o valor da comanda do dia da visita", async () => {
    const id = await lead();
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await toStage(id, "atendida", T0);
    await db.update(deals).set({ attendance: "compareceu", attendanceAt: T0 }).where(eq(deals.id, id));
    await db.insert(salesItems).values([
      { contactId: d.contactId, soldOn: "2026-10-13", item: "Corte", kind: "servico", totalCents: 15000, externalKey: "t:si1" },
      { contactId: d.contactId, soldOn: "2026-10-13", item: "Escova", kind: "servico", totalCents: 5000, externalKey: "t:si2" },
      { contactId: d.contactId, soldOn: "2026-09-01", item: "Antigo", kind: "servico", totalCents: 99900, externalKey: "t:si3" },
    ]);
    expect((await closeAttendedDeals(new Date(T0.getTime() + 2 * 86_400_000))).closed).toBe(0);
    const at = new Date(T0.getTime() + 3 * 86_400_000 + 60_000);
    expect((await closeAttendedDeals(at)).closed).toBe(1);
    const [after] = await db.select().from(deals).where(eq(deals.id, id));
    expect(await stageOf(id)).toBe("atendida");
    expect(after.valueCents).toBe(20000);
    expect(after).toMatchObject({ closedAt: at, conversationArchivedAt: at, awaitingReplySince: null });
    expect((await closeAttendedDeals(new Date(at.getTime() + 86_400_000))).closed).toBe(0); // já terminou: não repete
  });

  it("Encerrar em Atendida só encerra a conversa: continua em Atendida e aberta (os 3 dias terminam depois)", async () => {
    const id = await lead();
    await toStage(id, "atendida");
    await archiveConversation(id, ana);
    expect(await stageOf(id)).toBe("atendida");
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.closedAt).toBeNull();
    expect(d.conversationArchivedAt).not.toBeNull();
  });

  it("depois de terminar, mensagem nova dela abre uma conversa nova em Em conversa", async () => {
    const id = await lead("71988881234");
    await toStage(id, "atendida", T0);
    await closeAttendedDeals(new Date(T0.getTime() + 4 * 86_400_000));
    const r = await recordInbound({ channelId: null, externalId: "V1", phoneRaw: "71988881234", body: "Oi, quero voltar", at: new Date(T0.getTime() + 5 * 86_400_000) });
    if (!("dealId" in r)) throw new Error("sem conversa");
    expect(r.dealId).not.toBe(id);
    expect(await stageOf(r.dealId)).toBe("atendimento");
  });
});

describe("a cliente escreve com a bola com ela", () => {
  const phone = "71988884444";
  async function waiting(key: string) {
    const id = await lead(phone);
    await recordOutbound({ dealId: id, channelId: null, body: "Te mando o valor já", at: T0 });
    await toStage(id, key, new Date(T0.getTime() + 60_000));
    return id;
  }
  it("Em conversa esperando a cliente: 'Obrigada!' não para as tentativas; mensagem de verdade para", async () => {
    const id = await lead(phone);
    await recordOutbound({ dealId: id, channelId: null, body: "Te mando o valor já", at: T0 });
    await markWaitingForClient(id, {}, ana, new Date(T0.getTime() + 60_000));
    const attempt = async () => (await db.select().from(deals).where(eq(deals.id, id)))[0].followupAttempt;
    await recordInbound({ channelId: null, externalId: "B1", phoneRaw: phone, body: "Obrigada!", at: new Date(T0.getTime() + 120_000) });
    expect(await attempt()).toBe(1);
    await recordInbound({ channelId: null, externalId: "B2", phoneRaw: phone, body: "Pode ser sexta?", at: new Date(T0.getTime() + 180_000) });
    expect(await stageOf(id)).toBe("atendimento");
    expect(await attempt()).toBe(0);
  });
  it.each([["orcamento"], ["retorno"]])("%s → Em conversa quando ela escreve", async (key) => {
    const id = await waiting(key);
    await recordInbound({ channelId: null, externalId: `C-${key}`, phoneRaw: phone, body: "Quero marcar", at: new Date(T0.getTime() + 120_000) });
    expect(await stageOf(id)).toBe("atendimento");
  });
});
