import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { personVsGoal } from "./queries";
import { replyTimesByAuthor } from "./replies";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // 13/10/2026 (terça), hora de Salvador
let sara = "";

beforeEach(async () => {
  await resetDb();
  [sara] = (await db.insert(users).values([
    { name: "Sara Teste", email: "sara@teste.local", role: "atendente", signature: "SARA" },
    { name: "Cati Teste", email: "cati@teste.local", role: "gestor", signature: "CATI" },
  ]).returning()).map((u) => u.id);
});

async function conversa(i: number, at: Date) {
  const r = await recordInbound({ channelId: null, externalId: `in-${i}`, phoneRaw: `7199${1_000_000 + i}`, body: "oi", at });
  if (!("dealId" in r)) throw new Error("lead não criado");
  return r.dealId;
}
const responde = (dealId: string, id: string, at: Date, body: string) => recordOutbound({ dealId, channelId: null, externalId: id, body, fromPhone: true, at });

it("tempo de resposta por atendente: todas as respostas, pela assinatura; sem assinatura fica à parte", async () => {
  const d1 = await conversa(1, T(10));
  await responde(d1, "o1", T(10, 4), "*CATI - CASA FIAES:*\nOi!");                 // Cati, 4 min (primeira)
  await recordInbound({ channelId: null, externalId: "in-1b", phoneRaw: "71991000001", body: "e o preço?", at: T(11) });
  await responde(d1, "o2", T(11, 10), "*SARA - CASA FIAES:*\nR$ 100");             // Sara, 10 min (não é a primeira)
  const d2 = await conversa(2, T(12));
  await responde(d2, "o3", T(12, 2), "áudio sem assinatura");                       // sem autora
  const r = await replyTimesByAuthor({ period: "mes", now: T(18) });
  expect(r.rows.map((x) => [x.name, x.n, x.p50])).toEqual([["Cati Teste", 1, 240], ["Sara Teste", 1, 600]]);
  expect(r.semAutora).toBe(1);
  // A atendente (ownerId = ela, pelo scopedFilter) vê só a própria linha e não vê o "sem autora".
  expect(await replyTimesByAuthor({ period: "mes", now: T(18), ownerId: sara })).toEqual({ rows: [expect.objectContaining({ name: "Sara Teste", n: 1 })], semAutora: 0 });
});

it("o evento resposta guarda a mensagem que respondeu", async () => {
  const d = await conversa(3, T(10));
  const out = await responde(d, "o4", T(10, 1), "*SARA - CASA FIAES:*\nOi");
  const [ev] = await db.select().from(dealEvents).where(sql`${dealEvents.dealId} = ${d} and ${dealEvents.type} = 'resposta'`);
  expect(ev.payload.messageId).toBe("messageId" in out ? out.messageId : "?");
});

it("primeiras respostas (Cada pessoa contra a meta): vale a autora da mensagem, também nos eventos antigos (dona no evento, sem messageId)", async () => {
  for (let i = 0; i < 20; i++) {
    const id = await conversa(100 + i, T(9, i));
    await db.update(deals).set({ ownerId: sara }).where(eq(deals.id, id));
    await responde(id, `p${i}`, T(9, i + 1), "*CATI - CASA FIAES:*\nOi");
  }
  // Como era antes do Lote 1A: a resposta pelo celular contava para a dona e o evento não guardava a mensagem.
  await db.execute(sql`update deal_events set user_id = ${sara}, payload = payload - 'messageId' where type = 'resposta'`);
  const people = await personVsGoal({ period: "mes", now: T(18), compare: true });
  expect(people.map((p) => [p.name, p.n])).toEqual([["Cati Teste", 20]]);
});
