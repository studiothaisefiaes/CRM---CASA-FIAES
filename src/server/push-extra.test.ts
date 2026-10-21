import { it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { alerts, pushSubscriptions, users } from "./db/schema";
import { sendPushForPendingAlerts } from "./push";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });

it("menção numa nota vai por push; outros avisos sem espera continuam só no sino", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "ana@teste.local", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values({ userId: ana.id, endpoint: "https://p/ana", p256dh: "k", auth: "a" });
  await db.insert(alerts).values([
    { userId: ana.id, audience: "responsavel", type: "mencao", severity: "info", message: "Sara te marcou numa nota sobre Cliente Teste: “oi”", dedupeKey: "m1" },
    { userId: ana.id, audience: "responsavel", type: "assumiu_sua_conversa", severity: "info", message: "Cati assumiu a conversa de Cliente Teste", dedupeKey: "m2" },
  ]);
  const payloads: string[] = [];
  const r = await sendPushForPendingAlerts(async (_sub, payload) => { payloads.push(payload); return 201; });
  expect(r.sent).toBe(1);
  expect(JSON.parse(payloads[0])).toMatchObject({ title: "Te marcaram numa nota", body: "Sara te marcou numa nota sobre Cliente Teste: “oi”" });
});
