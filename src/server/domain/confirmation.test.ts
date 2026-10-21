import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { setNextActionTx } from "./tasks";
const combinado = (dealId: string, title: string, dueAt: Date) => db.transaction((tx) => setNextActionTx(tx, dealId, { title, dueAt }, null, new Date(dueAt.getTime() - 86_400_000)));

const T0 = new Date("2026-10-15T14:00:00Z"); // qui 15/10 11h em Salvador
let sara = "";
beforeEach(async () => {
  await resetDb();
  sara = (await db.insert(users).values({ name: "Sara Lima", email: "s@c.com", role: "atendente", passwordHash: "x", signature: "SARA" }).returning())[0].id;
});
const stageOf = async (id: string) => (await db.select({ k: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const openTitles = async (id: string) => (await db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)))).map((t) => t.title);

it("a confirmação padrão enviada pelo celular marca Agendado com o dia e a hora e fecha o combinado de remarcar/confirmar", async () => {
  const r = await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "71977770001", pushName: "Wanda Rezende", body: "Pode ser sábado?", at: T0 });
  if (!("dealId" in r)) throw new Error();
  await db.update(deals).set({ ownerId: sara }).where(eq(deals.id, r.dealId));
  await combinado(r.dealId, "Confirmar horário com Wanda Rezende", new Date(T0.getTime() - 3_600_000));
  await recordOutbound({ phoneRaw: "71977770001", channelId: null, externalId: "OUT1", fromPhone: true, at: new Date(T0.getTime() + 60_000),
    body: "*SARA - CASA FIAES:*\nConfirmado agendamento , aqui na Casa Fiaes, com o Especialista , para dia 17/10 (SÁBADO ) às 9h Avisos importantes" });
  expect(await stageOf(r.dealId)).toBe("agendado");
  expect((await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].scheduledAt?.toISOString()).toBe("2026-10-17T12:00:00.000Z");
  expect(await openTitles(r.dealId)).toEqual([]);
});

it("mensagem comum não mexe na etapa nem nos combinados", async () => {
  const r = await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "71977770002", pushName: "Bia", body: "Oi", at: T0 });
  if (!("dealId" in r)) throw new Error();
  await combinado(r.dealId, "Confirmar horário com Bia", T0);
  await recordOutbound({ phoneRaw: "71977770002", channelId: null, externalId: "OUT2", fromPhone: true, at: new Date(T0.getTime() + 60_000), body: "*SARA - CASA FIAES:*\nVou ver a agenda e te confirmo o dia 17/10 às 9h" });
  expect(await stageOf(r.dealId)).not.toBe("agendado");
  expect(await openTitles(r.dealId)).toEqual(["Confirmar horário com Bia"]);
});
