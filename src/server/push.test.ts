import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { alerts, pushSubscriptions, users } from "./db/schema";
import { sendPushForPendingAlerts } from "./push";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });

it("envia push para o responsável e marca pushed_at; inscrição expirada é removida", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values([{ userId: ana.id, endpoint: "https://p/ok", p256dh: "k", auth: "a" }, { userId: ana.id, endpoint: "https://p/gone", p256dh: "k", auth: "a" }]);
  await db.insert(alerts).values({ userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Maria esperando há 3 min", dedupeKey: "k1", waitKey: "w1" });
  const sent: string[] = [];
  const r = await sendPushForPendingAlerts(async (sub) => { if (sub.endpoint.endsWith("gone")) return 410; sent.push(sub.endpoint); return 201; });
  expect(r).toEqual({ sent: 1, failed: 1 });
  expect(sent).toEqual(["https://p/ok"]);
  expect((await db.select().from(alerts))[0].pushedAt).not.toBeNull();
  expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://p/ok"]);
});

async function seedPair() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gil] = await db.insert(users).values({ name: "Gil", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const [off] = await db.insert(users).values({ name: "Off", email: "o@c.com", role: "gestor", active: false, passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values([
    { userId: ana.id, endpoint: "https://p/ana", p256dh: "k", auth: "a" },
    { userId: gil.id, endpoint: "https://p/gil", p256dh: "k", auth: "a" },
    { userId: off.id, endpoint: "https://p/off", p256dh: "k", auth: "a" },
  ]);
  return { ana, gil };
}

it("nível 2 e alerta de gestão sem responsável vão para todos os gestores ativos, com o link do lead", async () => {
  const { ana } = await seedPair();
  await db.insert(alerts).values([
    { userId: ana.id, audience: "gestao", level: 2, type: "x", severity: "urgente", message: "escalado", dedupeKey: "k2", waitKey: "w2" },
    { userId: null, audience: "gestao", type: "y", severity: "urgente", message: "gestão", dedupeKey: "k3", waitKey: "w3" },
  ]);
  const calls: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  const r = await sendPushForPendingAlerts(async (sub, payload) => { calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); return 201; });
  expect(r).toEqual({ sent: 2, failed: 0 });
  expect(calls.map((c) => c.endpoint)).toEqual(["https://p/gil", "https://p/gil"]);
  expect(calls.find((c) => c.payload.body === "escalado")?.payload).toMatchObject({ title: "Atraso escalado para a gestão", url: "/funil" });
  expect(calls.find((c) => c.payload.body === "gestão")?.payload.title).toBe("Lead esperando");
});

it("marca pushed_at mesmo sem inscrição; alerta antigo ou resolvido é marcado sem enviar; erro que não é 404/410 não apaga", async () => {
  const { ana } = await seedPair();
  const old = new Date(Date.now() - 3 * 3600_000);
  await db.insert(alerts).values([
    { userId: ana.id, type: "a", message: "antigo", dedupeKey: "o1", waitKey: "w8", createdAt: old },
    { userId: ana.id, type: "a", message: "resolvido", dedupeKey: "o2", waitKey: "w9", resolvedAt: new Date() },
    { userId: null, audience: "responsavel", type: "a", message: "sem dono", dedupeKey: "o3", waitKey: "w4" },
    { userId: ana.id, type: "a", message: "falha", dedupeKey: "o4", waitKey: "w5" },
  ]);
  let n = 0;
  const r = await sendPushForPendingAlerts(async () => { n++; return 500; });
  expect(n).toBe(1);
  expect(r).toEqual({ sent: 0, failed: 1 });
  expect((await db.select().from(alerts)).every((a) => a.pushedAt !== null)).toBe(true);
  expect(await db.select().from(pushSubscriptions)).toHaveLength(3);
  // não reprocessa
  expect(await sendPushForPendingAlerts(async () => 201)).toEqual({ sent: 0, failed: 0 });
});

it("usa o dealId do alerta no link e grava last_ok_at; sender que lança conta como falha", async () => {
  const { ana } = await seedPair();
  const { deals, contacts, stages } = await import("./db/schema");
  const [c] = await db.insert(contacts).values({ phoneE164: "+5571999990000" }).returning();
  const [st] = await db.select().from(stages).limit(1);
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id }).returning();
  await db.insert(alerts).values({ userId: ana.id, dealId: d.id, type: "a", message: "m", dedupeKey: "d1", waitKey: "w6" });
  let url = "";
  const ok = await sendPushForPendingAlerts(async (_s, p) => { url = JSON.parse(p).url; return 201; });
  expect(ok.sent).toBe(1);
  expect(url).toBe(`/funil?lead=${d.id}`);
  expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, "https://p/ana")))[0].lastOkAt).not.toBeNull();
  await db.insert(alerts).values({ userId: ana.id, type: "a", message: "m2", dedupeKey: "d2", waitKey: "w7" });
  const bad = await sendPushForPendingAlerts(async () => { throw new Error("rede"); });
  expect(bad).toEqual({ sent: 0, failed: 1 });
});

it("só alerta de espera gera push: lembrete de tarefa e alertas sem wait_key ficam só no sistema (marcados, sem envio)", async () => {
  const { ana } = await seedPair();
  await db.insert(alerts).values([
    { userId: ana.id, type: "tarefa_vencendo", message: "Ligar — Maria", dedupeKey: "task:1", waitKey: "task:1" },
    { userId: ana.id, type: "aniversario", message: "Aniversário", dedupeKey: "an1" },
    { userId: ana.id, type: "sem_resposta_minutos", message: "Maria esperando", dedupeKey: "e1", waitKey: "deal:2026" },
  ]);
  const bodies: string[] = [];
  const r = await sendPushForPendingAlerts(async (_s, p) => { bodies.push(JSON.parse(p)); return 201; });
  expect(r).toEqual({ sent: 1, failed: 0 });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ title: "Lead esperando", body: "Maria esperando" });
  expect((await db.select().from(alerts)).every((a) => a.pushedAt !== null)).toBe(true);
});

it("envia as inscrições do alerta em paralelo e uma lenta/falha não impede as outras", async () => {
  const { ana } = await seedPair();
  await db.insert(pushSubscriptions).values({ userId: ana.id, endpoint: "https://p/ana2", p256dh: "k", auth: "a" });
  await db.insert(alerts).values({ userId: ana.id, type: "a", message: "m", dedupeKey: "p1", waitKey: "wp" });
  let running = 0, peak = 0;
  const r = await sendPushForPendingAlerts(async (s) => {
    running++; peak = Math.max(peak, running);
    await new Promise((res) => setTimeout(res, 30));
    running--;
    if (s.endpoint.endsWith("ana2")) throw new Error("rede");
    return 201;
  });
  expect(r).toEqual({ sent: 1, failed: 1 });
  expect(peak).toBe(2);
});
