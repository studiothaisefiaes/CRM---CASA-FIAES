import { it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { alerts, pushSubscriptions, users } from "./db/schema";
import { retryPush, sendPushForPendingAlerts, type PushSender } from "./push";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });
const sub = { endpoint: "https://p/x", p256dh: "k", auth: "a" };

it("falha passageira do serviço de push (5xx, 429, erro de rede) tenta mais uma vez; 404/410 e 2xx não repetem", async () => {
  const seq = (...r: (number | Error)[]) => { const calls: number[] = []; const s: PushSender = async () => { const v = r[calls.length]; calls.push(1); if (v instanceof Error) throw v; return v; }; return { s, calls }; };
  for (const [first, second, want, n] of [[503, 201, 201, 2], [429, 201, 201, 2], [new Error("ECONNRESET"), 201, 201, 2], [500, 502, 502, 2], [410, 201, 410, 1], [201, 500, 201, 1]] as const) {
    const { s, calls } = seq(first, second);
    expect(await retryPush(s, 0)(sub, "{}")).toBe(want);
    expect(calls.length).toBe(n);
  }
});

it("no envio dos alertas: 503 seguido de 201 conta como enviado e não apaga a inscrição", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values({ userId: ana.id, ...sub });
  await db.insert(alerts).values({ userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Maria esperando", dedupeKey: "k1", waitKey: "w1" });
  let n = 0;
  const r = await sendPushForPendingAlerts(async () => (n++ === 0 ? 503 : 201), { retryDelayMs: 0 });
  expect(r).toEqual({ sent: 1, failed: 0 });
  expect((await db.select().from(pushSubscriptions)).length).toBe(1);
});
