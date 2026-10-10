import { it, expect, beforeEach } from "vitest";
import { db } from "../db"; import { alerts, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals"; import { runRules } from "./engine";
import { resetDb } from "../../../test/db";
beforeEach(async () => { await resetDb(); await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }); });
it("mesma espera: 1 alerta, escala para gestão e resolve com a resposta", async () => { // Review Focus 4
  const t0 = new Date("2026-10-13T13:00:00Z");
  const r = await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999991111", body: "oi", at: t0 });
  if (!("dealId" in r)) throw new Error();
  for (const m of [3, 3, 5, 11, 12, 30]) await runRules(new Date(t0.getTime() + m * 60_000));
  const active = (await db.select().from(alerts)).filter((a) => !a.resolvedAt);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ level: 2, audience: "gestao" });
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi!", at: new Date(t0.getTime() + 31 * 60_000) });
  expect((await db.select().from(alerts)).every((a) => a.resolvedAt)).toBe(true);
});
