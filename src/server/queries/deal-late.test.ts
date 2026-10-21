import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { alerts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { getDealDetail } from "./deal";

beforeEach(async () => { await resetDb(); });
const lead = async (phone: string) => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}`, phoneRaw: phone, body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};

it("o detalhe diz se a espera tem alerta aberto (a regra do vermelho); aviso de tarefa não conta", async () => {
  const a = await lead("71999994441");
  const b = await lead("71999994442");
  expect((await getDealDetail(a))!.late).toBe(false);
  await db.insert(alerts).values({ dealId: a, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `${a}:2026-10-15T12:00:00.000Z` });
  await db.insert(alerts).values({ dealId: b, audience: "gestao", type: "tarefa_vencendo", severity: "info", message: "t", dedupeKey: "k2", waitKey: "task:abc" });
  expect((await getDealDetail(a))!.late).toBe(true);
  expect((await getDealDetail(b))!.late).toBe(false);
});
