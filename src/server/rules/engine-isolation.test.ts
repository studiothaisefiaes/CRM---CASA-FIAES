import { afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, automations, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { saveAutomation } from "../domain/config";
import { runRules } from "./engine";
import { resetDb } from "../../../test/db";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador
let gestor = "";
beforeEach(async () => {
  await resetDb();
  await db.update(automations).set({ enabled: false });
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});
afterEach(async () => { await db.execute(sql`alter table stages rename column quebrou to stale_days`).catch(() => {}); });

it("uma automação cuja busca quebra não derruba as outras: o erro vai para o resumo e as demais disparam (23/10)", async () => {
  await recordInbound({ channelId: null, externalId: "iso-1", phoneRaw: "71999810091", pushName: "Cliente", body: "oi", at: new Date(T0.getTime() - 20 * 60_000) });
  await saveAutomation(null, { name: "A quebrada", enabled: true, trigger: { type: "parado_dias", useStageLimit: true, days: 1 }, conditions: [], actions: [{ type: "alertar_gestao", message: "{nome} parada" }] }, gestor);
  await saveAutomation(null, { name: "B sem resposta", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 10 }, conditions: [], actions: [{ type: "alertar_gestao", message: "{nome} sem resposta" }] }, gestor);
  // A busca do "parado pelo limite da etapa" lê stages.stale_days: sem a coluna, a consulta falha.
  await db.execute(sql`alter table stages rename column stale_days to quebrou`);
  const s = await runRules(T0);
  expect(s.errors.some((e) => e.startsWith("A quebrada"))).toBe(true);
  expect(s.fired).toBe(1);
  expect((await db.select().from(alerts)).filter((x) => x.type !== "automacao_falhou").length).toBe(1);
});

it("a automação quebrada avisa a gestão uma vez por dia, sem o texto do erro (24/10)", async () => {
  await saveAutomation(null, { name: "A quebrada", enabled: true, trigger: { type: "parado_dias", useStageLimit: true, days: 1 }, conditions: [], actions: [{ type: "alertar_gestao", message: "{nome} parada" }] }, gestor);
  await db.execute(sql`alter table stages rename column stale_days to quebrou`);
  await runRules(T0);
  await runRules(new Date(T0.getTime() + 60_000)); // a rodada do minuto seguinte não repete
  const a = await db.select().from(alerts);
  expect(a.map((x) => [x.audience, x.type])).toEqual([["gestao", "automacao_falhou"]]);
  expect(a[0].message).toContain("A quebrada");
  expect(a[0].message).not.toContain("quebrou");
  await runRules(new Date(T0.getTime() + 86_400_000)); // no dia seguinte, avisa de novo
  expect((await db.select().from(alerts)).length).toBe(2);
});
