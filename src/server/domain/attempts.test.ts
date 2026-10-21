import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { moveDealTx, moveToKindTx, recordInbound, recordOutbound } from "./deals";
import { REMARCAR_META, setNextActionTx } from "./tasks";
import { UserFacingError } from "./errors";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador (sem horário salvo: vale o padrão seg–sex 8–20, sáb 8–17)
let ana = "";
const move = (id: string, key: string, at = T0, opts = {}) => db.transaction((tx) => moveDealTx(tx, id, key, null, "teste", at, opts));
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

beforeEach(async () => {
  await resetDb(); await etapasAntigasAtivas();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function emConversa(phone = "71988880001") {
  const r = await recordInbound({ channelId: null, externalId: `in-${phone}`, phoneRaw: phone, pushName: "Rita Souza", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi Rita!", at: T0 });
  return r.dealId;
}

it("entrar em Aguardando cliente: tentativa 1 de 3 em D+1 às 10h, como próxima ação da dona (nada é enviado)", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  const d = await dealOf(id);
  expect(d.followupAttempt).toBe(1);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
  const [t] = await openTasks(id);
  expect(t).toMatchObject({ id: d.followupTaskId, title: "Tentativa 1 de 3: retomar contato com Rita", assigneeId: ana });
});

it("Orçamento enviado começa em 2 dias", async () => {
  const id = await emConversa();
  await move(id, "orcamento");
  expect((await dealOf(id)).followupDueAt?.toISOString()).toBe("2026-10-15T13:00:00.000Z");
});

it("próxima ação futura que a equipe já combinou vira a tentativa 1 (não é trocada)", async () => {
  const id = await emConversa();
  const planned = await db.transaction((tx) => setNextActionTx(tx, id, { title: "Mandar valores", dueAt: new Date("2026-10-16T13:00:00Z") }, ana, T0));
  await move(id, "followup_1");
  const d = await dealOf(id);
  expect(d).toMatchObject({ followupAttempt: 1, followupTaskId: planned.id });
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Mandar valores"]);
});

it("sair de Aguardando zera o contador e cancela só a tentativa; o Remarcar fica", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  const tentativa = (await dealOf(id)).followupTaskId!;
  await move(id, "atendimento", new Date(T0.getTime() + 3_600_000));
  expect(await dealOf(id)).toMatchObject({ followupAttempt: 0, followupDueAt: null, followupTaskId: null });
  expect((await db.select().from(tasks).where(eq(tasks.id, tentativa)))[0].doneAt).not.toBeNull();

  await move(id, "followup_1", new Date(T0.getTime() + 2 * 3_600_000), { resumeAt: new Date("2026-10-14T13:00:00Z"), taskTitle: "Remarcar com Rita", taskMeta: { ...REMARCAR_META } });
  await move(id, "atendimento", new Date(T0.getTime() + 3 * 3_600_000));
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Remarcar com Rita"]);
});

it("etapa desativada (Follow-up 2) recusa com texto claro", async () => {
  const id = await emConversa();
  await expect(move(id, "followup_2")).rejects.toBeInstanceOf(UserFacingError);
  await expect(move(id, "followup_2")).rejects.toThrow("desativada");
});

it("moveToKindTx: já numa etapa do tipo, não faz nada (nem nova tentativa)", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  await db.transaction((tx) => moveToKindTx(tx, id, "followup", null, "teste", new Date(T0.getTime() + 60_000)));
  expect((await openTasks(id))).toHaveLength(1);
  expect((await dealOf(id)).followupAttempt).toBe(1);
});

it("dona que saiu da equipe não derruba a mudança de etapa: a tentativa fica sem responsável", async () => {
  const id = await emConversa();
  await db.update(users).set({ active: false }).where(eq(users.id, ana));
  await move(id, "followup_1");
  expect((await openTasks(id))[0].assigneeId).toBeNull();
});

it("data de retomar no passado: erro claro, nada muda", async () => {
  const id = await emConversa();
  await expect(move(id, "followup_1", T0, { resumeAt: new Date("2026-10-01T13:00:00Z") })).rejects.toThrow(/já passou/);
  expect((await dealOf(id)).followupAttempt).toBe(0);
});
