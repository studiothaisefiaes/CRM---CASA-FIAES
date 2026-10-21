import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, recordInbound } from "./deals";
import { markAttendance, scheduleDeal, undoMissedAttendance } from "./updates";

// QA r58 (M-2): "Faltou" pede confirmação e tem Desfazer em todo lugar. Na conversa, Faltou muda a etapa e cria o Remarcar: o Desfazer
// volta tudo como estava (etapa, comparecimento, tentativas e combinados), desde que nada tenha acontecido na conversa depois.
const T0 = new Date("2026-10-13T13:00:00Z");
let ana = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const open = async (id: string) => (await db.select().from(tasks).where(and(eq(tasks.dealId, id), isNull(tasks.doneAt)))).map((t) => `${t.kind}:${t.title}`).sort();
async function agendada(phone: string) {
  const r = await recordInbound({ channelId: null, externalId: `U-${phone}`, phoneRaw: phone, pushName: "Rita Souza", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await scheduleDeal(r.dealId, "2026-10-13T15:00:00Z", ana, T0);
  return r.dealId;
}

describe("Desfazer o Faltou da conversa", () => {
  it("volta a etapa, o comparecimento e os combinados de antes; o Remarcar some", async () => {
    const id = await agendada("71988880001");
    const [antes] = await db.select().from(deals).where(eq(deals.id, id));
    const tarefasAntes = await open(id);
    expect(await markAttendance(id, "faltou", ana)).toMatchObject({ changed: true, remarcar: true });
    expect(await stageOf(id)).toBe("atendimento");
    // Abrir a conversa (visto) não gera evento: o Desfazer não pode voltar o visto (revisão).
    const visto = new Date("2026-10-13T16:00:00Z");
    await db.update(deals).set({ seenAt: visto }).where(eq(deals.id, id));
    await undoMissedAttendance(id, ana);
    const [depois] = await db.select().from(deals).where(eq(deals.id, id));
    expect(await stageOf(id)).toBe("agendado");
    expect(depois).toMatchObject({ attendance: antes.attendance, followupAttempt: antes.followupAttempt, followupDueAt: antes.followupDueAt, stageEnteredAt: antes.stageEnteredAt });
    expect(await open(id)).toEqual(tarefasAntes);
    expect(depois.seenAt?.toISOString()).toBe(visto.toISOString());
    await expect(undoMissedAttendance(id, ana)).rejects.toThrow("Não há falta para desfazer");
  });

  it("recusa se a conversa mudou depois (ex.: alguém mexeu na etapa)", async () => {
    const id = await agendada("71988880002");
    await markAttendance(id, "faltou", ana);
    await db.transaction((tx) => moveDealTx(tx, id, "orcamento", ana, "manual"));
    await expect(undoMissedAttendance(id, ana)).rejects.toThrow("A conversa mudou depois da falta");
  });
});
