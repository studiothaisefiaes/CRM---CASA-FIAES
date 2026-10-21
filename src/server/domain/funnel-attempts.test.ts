import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, lists, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { markWaitingForClient, sweepAttempts } from "./funnel";
import { completeTask, setNextActionTx } from "./tasks";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h (horário padrão: seg–sex 8–20, sáb 8–17)
const at = (iso: string) => new Date(iso);
let ana = "";
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
const casa = (id: string, iso: string) => recordOutbound({ dealId: id, channelId: null, body: "Oi Rita, conseguiu ver?", at: at(iso) });

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function aguardando() {
  const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71988886666", pushName: "Rita", body: "Quanto custa?", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "R$ 150", at: T0 });
  await markWaitingForClient(r.dealId, {}, ana, T0); // tentativa 1: quarta 14/10 10h
  return r.dealId;
}

it("D+1, D+3, D+7: a tentativa conta quando a Casa escreve no dia dela ou alguém conclui o combinado; depois de 2 dias vira Perdido", async () => {
  const id = await aguardando();
  await casa(id, "2026-10-13T16:00:00Z"); // terça: antes do dia da tentativa 1, não conta
  expect((await sweepAttempts(at("2026-10-14T12:00:00Z"))).advanced).toBe(0);

  await casa(id, "2026-10-14T14:00:00Z"); // quarta: tentativa 1 feita pelo celular
  expect((await sweepAttempts(at("2026-10-14T14:05:00Z"))).advanced).toBe(1);
  let d = await dealOf(id);
  expect(d).toMatchObject({ followupAttempt: 2 });
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-16T13:00:00.000Z"); // sexta (D+3)
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Tentativa 2 de 3: retomar contato com Rita"]);

  await completeTask(d.followupTaskId!, ana); // tentativa 2 marcada como feita (ligou)
  expect((await sweepAttempts(at("2026-10-16T14:00:00Z"))).advanced).toBe(1);
  d = await dealOf(id);
  expect(d.followupAttempt).toBe(3);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-20T13:00:00.000Z"); // terça seguinte (D+7)

  await casa(id, "2026-10-20T15:00:00Z");
  await sweepAttempts(at("2026-10-20T15:05:00Z"));
  d = await dealOf(id);
  expect(d.followupAttempt).toBe(4);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-22T13:00:00.000Z"); // 2 dias para a última resposta
  expect(await openTasks(id)).toHaveLength(0);

  expect((await sweepAttempts(at("2026-10-22T12:00:00Z"))).lost).toBe(0);
  expect((await sweepAttempts(at("2026-10-22T13:01:00Z"))).lost).toBe(1);
  expect(await stageOf(id)).toBe("perdido");
  d = await dealOf(id);
  const [reason] = await db.select().from(lists).where(eq(lists.id, d.lostReasonId!));
  expect(reason.label).toBe("Não respondeu mais");
  expect(d.recontactAt?.toISOString()).toBe("2026-11-21T13:00:00.000Z");
});

it("ninguém tentou: a conversa NÃO vira Perdido sozinha; o combinado fica vencido", async () => {
  const id = await aguardando();
  for (const iso of ["2026-10-15T13:00:00Z", "2026-10-21T13:00:00Z", "2026-10-30T13:00:00Z"]) await sweepAttempts(at(iso));
  expect(await stageOf(id)).toBe("atendimento");
  expect((await dealOf(id)).followupAttempt).toBe(1);
});

it("a equipe trocou a próxima ação: a nova passa a ser a tentativa atual", async () => {
  const id = await aguardando();
  const t = await db.transaction((tx) => setNextActionTx(tx, id, { title: "Ligar à tarde", dueAt: at("2026-10-15T18:00:00Z") }, ana, T0));
  expect((await sweepAttempts(at("2026-10-14T12:00:00Z"))).adopted).toBe(1);
  expect(await dealOf(id)).toMatchObject({ followupTaskId: t.id, followupAttempt: 1 });
});

it("a cliente respondeu: segue em Em conversa, contador zera e a tentativa aberta é cancelada", async () => {
  const id = await aguardando();
  await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71988886666", body: "Quero marcar sexta", at: at("2026-10-14T12:00:00Z") });
  expect(await stageOf(id)).toBe("atendimento");
  expect(await dealOf(id)).toMatchObject({ followupAttempt: 0, followupTaskId: null });
  expect(await openTasks(id)).toHaveLength(0);
});

it("2ª vez que perde por não responder: sem recontato (nada de ciclo eterno)", async () => {
  const id = await aguardando();
  await db.insert(dealEvents).values({ dealId: id, type: "etapa_alterada", payload: { de: "followup_1", para: "perdido", motivo: "nao_respondeu" } });
  await db.update(deals).set({ followupAttempt: 4, followupDueAt: at("2026-10-14T13:00:00Z") }).where(eq(deals.id, id));
  await sweepAttempts(at("2026-10-14T14:00:00Z"));
  expect(await stageOf(id)).toBe("perdido");
  expect((await dealOf(id)).recontactAt).toBeNull();
});

it("dona saiu da equipe no meio das tentativas: a varredura não trava e a próxima nasce sem responsável", async () => {
  const id = await aguardando();
  await db.update(users).set({ active: false }).where(eq(users.id, ana));
  await casa(id, "2026-10-14T14:00:00Z");
  expect(await sweepAttempts(at("2026-10-14T14:05:00Z"))).toMatchObject({ advanced: 1, errors: [] });
  const [t] = await openTasks(id);
  expect(t).toMatchObject({ title: "Tentativa 2 de 3: retomar contato com Rita", assigneeId: null });
});
