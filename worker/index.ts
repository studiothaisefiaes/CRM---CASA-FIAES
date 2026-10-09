import "dotenv/config";
process.env.TZ ??= "America/Bahia";
import { PgBoss } from "pg-boss";
import { runRules } from "../src/server/rules/engine";
import { processHistoryEvents, purgeOldWebhookEvents, retryFailedWebhooks } from "../src/server/whatsapp/webhook";
import { purgeExpiredSessions } from "../src/server/auth/sessions-store";
import { pool } from "../src/server/db";

// Worker do CRM: automações (a cada minuto), reprocessamento de webhooks e limpeza.
// Roda separado do app: `npm run worker` (no Contabo, sob pm2).
const QUEUES = { rules: "regras", webhooks: "webhooks-reprocessar", history: "historico-whatsapp", cleanup: "limpeza" } as const;

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
  await boss.schedule(QUEUES.rules, "* * * * *", null, { tz: "America/Bahia", singletonKey: "rules" });
  await boss.schedule(QUEUES.webhooks, "*/2 * * * *", null, { tz: "America/Bahia" });
  await boss.schedule(QUEUES.history, "* * * * *", null, { tz: "America/Bahia", singletonKey: "historico" });
  await boss.schedule(QUEUES.cleanup, "15 4 * * *", null, { tz: "America/Bahia" });

  await boss.work(QUEUES.rules, { batchSize: 1 }, async () => {
    const t = Date.now(); const s = await runRules();
    if (s.fired || s.errors.length) console.log(`[regras] ${s.fired} disparos, ${s.alerts} alertas, ${s.moved} movidos (${Date.now() - t} ms)`, s.errors);
  });
  await boss.work(QUEUES.webhooks, async () => { const r = await retryFailedWebhooks(); if (r.tried) console.log("[webhooks]", r); });
  // Histórico do WhatsApp ao conectar um número: um lote por vez até esvaziar.
  await boss.work(QUEUES.history, { batchSize: 1 }, async () => {
    for (let i = 0; i < 50; i++) { const r = await processHistoryEvents(5); if (r.lotes) console.log("[histórico]", r); if (r.lotes < 5) break; }
  });
  await boss.work(QUEUES.cleanup, async () => { await purgeExpiredSessions(); await purgeOldWebhookEvents(); });

  // Primeira rodada imediata (sem esperar o próximo minuto cheio).
  await boss.send(QUEUES.rules, {});
  console.log("Worker do CRM rodando. Automações a cada minuto.");

  const stop = async () => { console.log("Encerrando worker…"); await boss.stop({ graceful: true, timeout: 10_000 }); await pool.end(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
