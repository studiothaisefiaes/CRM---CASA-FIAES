import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { enterAttendedTx } from "./funnel";
import { completeTaskTx } from "./tasks";

const T0 = new Date("2026-10-21T18:00:00Z"); // terça 15h: a visita
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;

let dealId = "";
beforeEach(async () => {
  await resetDb();
  const r = await recordInbound({ channelId: null, externalId: "V1", phoneRaw: "71988887777", pushName: "Virna", body: "Cheguei!", at: at(-1) });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  await recordOutbound({ dealId, channelId: null, body: "Seja bem-vinda!", at: at(-0.9) });
  await db.transaction((tx) => enterAttendedTx(tx, dealId, null, "compareceu", T0));
});

const closePos = async () => {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt)));
  await db.transaction((tx) => completeTaskTx(tx, t.id, null, "cancelada"));
};

describe("Atendida: a Casa retoma a conversa (Cati 23/10, Virna: 'quando eu começo a conversar, por que não vai pra Em conversa?')", () => {
  it("pós-atendimento feito e conversa parada há 12 h ou mais: a mensagem da Casa leva para Em conversa", async () => {
    await closePos();
    await recordOutbound({ dealId, channelId: null, body: "Oi, Virna! Passando para retomarmos nossa conversa", at: at(41) });
    expect(await stageOf(dealId)).toBe("atendimento");
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "etapa_alterada")));
    expect(ev.at(-1)!.payload).toMatchObject({ para: "atendimento", motivo: "casa_retomou" });
  });

  it("com o pós-atendimento ainda aberto (agradecer, pedir foto): continua em Atendida", async () => {
    await recordOutbound({ dealId, channelId: null, body: "Obrigada pela visita! Manda uma foto?", at: at(15) });
    expect(await stageOf(dealId)).toBe("atendida");
  });

  it("conversa ainda correndo (última mensagem há menos de 12 h): continua em Atendida", async () => {
    await closePos();
    await recordInbound({ channelId: null, externalId: "V2", phoneRaw: "71988887777", body: "Amei o cabelo!", at: at(16) });
    await recordOutbound({ dealId, channelId: null, body: "Que bom!", at: at(17) });
    expect(await stageOf(dealId)).toBe("atendida");
  });

  it("mensagem automática não retoma", async () => {
    await closePos();
    await recordOutbound({ dealId, channelId: null, body: "Lembrete", automated: true, at: at(41) });
    expect(await stageOf(dealId)).toBe("atendida");
  });
});
