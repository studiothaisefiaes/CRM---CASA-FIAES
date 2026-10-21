import { beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, stages } from "../db/schema";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { funnelMilestones } from "../reports/queries";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // 13/10/2026, hora de Salvador
beforeEach(async () => { await resetDb(); await etapasAntigasAtivas(); });

async function escreve(id: string, phone: string, at: Date) {
  const r = await recordInbound({ channelId: null, externalId: id, phoneRaw: phone, body: "oi", at });
  if (!("dealId" in r) || !("created" in r)) throw new Error("sem lead");
  return r;
}
const kindOf = async (dealId: string) =>
  (await db.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].kind;

it("cliente que volta depois de Fechado ou Perdido: a conversa nova começa em Em conversa (marcada 'voltou'); número novo segue em Novo contato", async () => {
  const a = await escreve("a1", "71990000101", T(9));
  await db.transaction((tx) => moveDealTx(tx, a.dealId, "fechado", null, "venda", T(9, 30)));
  const a2 = await escreve("a2", "71990000101", T(11));
  expect(a2.created).toBe(true);
  expect(await kindOf(a2.dealId)).toBe("atendimento");
  const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, a2.dealId), eq(dealEvents.type, "lead_criado")));
  expect(ev.payload).toMatchObject({ voltou: true, initialStage: "atendimento" });

  const b = await escreve("b1", "71990000102", T(9));
  await db.transaction((tx) => moveDealTx(tx, b.dealId, "perdido", null, "manual", T(9, 30)));
  expect(await kindOf((await escreve("b2", "71990000102", T(11))).dealId)).toBe("atendimento");

  expect(await kindOf((await escreve("c1", "71990000103", T(11))).dealId)).toBe("lead");
});

it("relatório: a conversa de quem voltou só conta como respondida depois que a Casa responde", async () => {
  const a = await escreve("a1", "71990000101", T(9));
  await db.transaction((tx) => moveDealTx(tx, a.dealId, "fechado", null, "venda", T(9, 30)));
  const a2 = await escreve("a2", "71990000101", T(11));
  const antes = await funnelMilestones({ period: "mes", now: T(12) });
  expect(antes).toMatchObject({ leads: 2, respondidos: 1 }); // o fechado conta; a conversa nova em Em conversa, sem resposta, não
  await recordOutbound({ dealId: a2.dealId, channelId: null, externalId: "o1", body: "Oi de novo!", fromPhone: true, at: T(11, 5) });
  expect(await funnelMilestones({ period: "mes", now: T(12) })).toMatchObject({ leads: 2, respondidos: 2 });
});
