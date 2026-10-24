import { afterAll, beforeAll, expect, it } from "vitest";
import { PgBoss } from "pg-boss";
import { pool } from "../db";
import { ensureQueue, QUEUE_DELETE_AFTER_S, releaseStaleActive, trimScheduleQueue } from "./queues";

// pg-boss de verdade, num schema só do teste (o worker usa "pgboss").
const SCHEMA = "pgboss_teste_filas";
let boss: PgBoss;
beforeAll(async () => {
  await pool.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: SCHEMA, supervise: false });
  boss.on("error", () => {});
  await boss.start();
}, 30_000);
afterAll(async () => { await boss.stop({ graceful: false }); await pool.query(`drop schema if exists ${SCHEMA} cascade`); });

it("fila nova: um job por vez (exclusive) e concluídos guardados só 1 dia", async () => {
  await ensureQueue(boss, "nova");
  const q = await boss.getQueue("nova");
  expect([q?.policy, q?.deleteAfterSeconds]).toEqual(["exclusive", QUEUE_DELETE_AFTER_S]);
  expect(QUEUE_DELETE_AFTER_S).toBe(86_400);
  // Com um job na fila, o próximo do mesmo minuto não entra (antes empilhava quando a rodada passava de 1 min).
  expect(await boss.send("nova", {})).toBeTruthy();
  expect(await boss.send("nova", {})).toBeNull();
});

it("fila antiga (standard, 7 dias, como em produção): é recriada exclusive; rodar de novo não mexe", async () => {
  await boss.createQueue("antiga");
  await boss.send("antiga", {});
  await ensureQueue(boss, "antiga");
  const q = await boss.getQueue("antiga");
  expect([q?.policy, q?.deleteAfterSeconds]).toEqual(["exclusive", QUEUE_DELETE_AFTER_S]);
  const id = await boss.send("antiga", {});
  expect(id).toBeTruthy();
  await ensureQueue(boss, "antiga"); // segunda partida do worker: a fila e o job continuam
  expect((await boss.getJobById("antiga", id!))?.id).toBe(id);
});

it("exclusive mas com a limpeza antiga (7 dias): só ajusta a limpeza", async () => {
  await boss.createQueue("meio", { policy: "exclusive" });
  const id = await boss.send("meio", {});
  await ensureQueue(boss, "meio");
  expect((await boss.getQueue("meio"))?.deleteAfterSeconds).toBe(QUEUE_DELETE_AFTER_S);
  expect((await boss.getJobById("meio", id!))?.id).toBe(id);
});

it("a fila interna dos agendamentos também guarda só 1 dia", async () => {
  await trimScheduleQueue(boss);
  expect((await boss.getQueue("__pgboss__send-it"))?.deleteAfterSeconds).toBe(QUEUE_DELETE_AFTER_S);
});

it("job que ficou 'active' de um worker que morreu: cancelado na partida, e o disparo seguinte com a mesma chave entra", async () => {
  await ensureQueue(boss, "presa");
  expect(await boss.send("presa", {}, { singletonKey: "rules" })).toBeTruthy();
  const [job] = await boss.fetch("presa"); // ficou active; o worker "morreu" sem concluir
  expect(job).toBeTruthy();
  expect(await boss.send("presa", {}, { singletonKey: "rules" })).toBeNull();
  expect(await releaseStaleActive(boss, "presa")).toBe(1);
  expect(await boss.send("presa", {}, { singletonKey: "rules" })).toBeTruthy();
  expect(await releaseStaleActive(boss, "presa")).toBe(0); // o que está só na fila não é mexido
});
