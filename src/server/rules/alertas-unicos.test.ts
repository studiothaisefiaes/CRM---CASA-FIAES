import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { automationInputSchema } from "./types";
import { db } from "../db"; import { alerts, automations, users } from "../db/schema";
import { moveDeal, recordInbound, recordOutbound } from "../domain/deals"; import { runRules } from "./engine";
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

const T0 = new Date("2026-10-13T13:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
async function newLead(phone = "71999991111") {
  const r = await recordInbound({ channelId: null, externalId: `E-${phone}-${Math.random()}`, phoneRaw: phone, body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error();
  return r.dealId;
}

it("alertar_gestao em gatilho de espera escala o alerta do responsável (não vira no-op)", async () => {
  await db.update(automations).set({ actions: [{ type: "alertar_gestao", message: "{nome} sem resposta há {minutos} min" }] }).where(eq(automations.key, "gestao_10min"));
  await newLead();
  for (const m of [2, 30, 32]) await runRules(at(m)); // escala aos 30 min (Lote 0)
  const active = (await db.select().from(alerts)).filter((a) => !a.resolvedAt);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ audience: "gestao", level: 2 });
});

it("responder e a cliente escrever de novo: nova espera, novo alerta com outra wait_key", async () => {
  const dealId = await newLead();
  await runRules(at(3));
  await recordOutbound({ dealId, channelId: null, body: "Oi!", at: at(4) });
  await recordInbound({ channelId: null, externalId: "E-again", phoneRaw: "71999991111", body: "e aí?", at: at(10) });
  await runRules(at(14));
  const all = await db.select().from(alerts);
  expect(all).toHaveLength(2);
  expect(new Set(all.map((a) => a.waitKey)).size).toBe(2);
  expect(all.filter((a) => !a.resolvedAt)).toHaveLength(1);
  expect(all.filter((a) => a.resolvedAt)).toHaveLength(1);
});

it("fechar ou perder o lead resolve os alertas abertos", async () => {
  const dealId = await newLead();
  await runRules(at(12)); // alerta nível 2
  expect((await db.select().from(alerts)).filter((a) => !a.resolvedAt)).toHaveLength(1);
  await moveDeal(dealId, "perdido", null);
  expect((await db.select().from(alerts)).every((a) => a.resolvedAt)).toBe(true);
});

it("escalar_gestao só vale com gatilho de espera", () => {
  const base = { name: "Teste", enabled: true, conditions: [], actions: [{ type: "escalar_gestao" as const }] };
  expect(automationInputSchema.safeParse({ ...base, trigger: { type: "sem_resposta_minutos", minutes: 10 } }).success).toBe(true);
  const r = automationInputSchema.safeParse({ ...base, trigger: { type: "parado_dias", days: 2 } });
  expect(r.success).toBe(false);
  if (!r.success) expect(r.error.issues[0].message).toMatch(/sem resposta/i);
});

it("escalar o alerta reabre o aviso por push (pushed_at volta a nulo) para a gestão ser avisada", async () => {
  await newLead();
  await runRules(at(3));
  await db.update(alerts).set({ pushedAt: new Date() });
  for (const m of [30, 32]) await runRules(at(m)); // escala aos 30 min (Lote 0)
  const [a] = (await db.select().from(alerts)).filter((x) => !x.resolvedAt);
  expect(a).toMatchObject({ level: 2, pushedAt: null });
});
