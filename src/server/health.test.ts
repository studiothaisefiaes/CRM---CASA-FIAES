import { it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { settings, channels } from "./db/schema";
import { getHealth } from "./health";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });

it("worker sem batida há 5 min = degraded; banco ok", async () => {
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date(Date.now() - 5 * 60_000).toISOString() });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado" });
  const h = await getHealth();
  expect(h).toMatchObject({ status: "degraded", db: true, worker: { ok: false } });
  expect(h.whatsapp[0]).toEqual({ name: "Recepção", status: "conectado" });
});

it("worker com batida recente e canais conectados = ok", async () => {
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date().toISOString() });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado" });
  expect(await getHealth()).toMatchObject({ status: "ok", db: true, worker: { ok: true } });
});

it("canal em erro ou desconectado = degraded mesmo com worker vivo", async () => {
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date().toISOString() });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "erro" });
  expect((await getHealth()).status).toBe("degraded");
});

it("sem batida nenhuma = degraded com lastBeatAt nulo", async () => {
  const h = await getHealth();
  expect(h).toMatchObject({ status: "degraded", worker: { ok: false, lastBeatAt: null } });
});

it("canal removido não conta: some da lista e não degrada", async () => {
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date().toISOString() });
  await db.insert(channels).values([
    { name: "Recepção", instanceName: "rec", status: "conectado" },
    { name: "X (removido)", instanceName: "x", status: "desconectado" },
  ]);
  const h = await getHealth();
  expect(h.status).toBe("ok");
  expect(h.whatsapp).toEqual([{ name: "Recepção", status: "conectado" }]);
});

it("canal não removido fora de 'conectado' (ex.: aguardando QR) deixa degraded", async () => {
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date().toISOString() });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "aguardando_qr" });
  expect((await getHealth()).status).toBe("degraded");
});
