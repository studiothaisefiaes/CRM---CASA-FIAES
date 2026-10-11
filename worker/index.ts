import "dotenv/config";
process.env.TZ ??= "America/Bahia";
import { PgBoss } from "pg-boss";
import { runRules } from "../src/server/rules/engine";
import { processHistoryEvents, purgeOldWebhookEvents, retryFailedWebhooks } from "../src/server/whatsapp/webhook";
import { purgeExpiredSessions } from "../src/server/auth/sessions-store";
import { pool, db } from "../src/server/db";
import { settings } from "../src/server/db/schema";
import { downloadPendingMedia, refreshAvatars } from "../src/server/whatsapp/media";
import { checkConnections } from "../src/server/whatsapp/watchdog";
import { purgeExpiredMedia } from "../src/server/whatsapp/retention";
import { getMediaRetentionMonths } from "../src/server/domain/messaging-settings";
import { remindDueTasks } from "../src/server/domain/tasks";
import { drainOutbox } from "../src/server/domain/outbox";
import { sendPushForPendingAlerts } from "../src/server/push";
import { vapidConfig } from "../src/server/env";

// Worker do CRM: automações (a cada minuto), reprocessamento de webhooks e limpeza.
// Roda separado do app: `npm run worker` (no Contabo, sob pm2).
const QUEUES = { rules: "regras", webhooks: "webhooks-reprocessar", history: "historico-whatsapp", media: "midia-whatsapp", cleanup: "limpeza", retention: "retencao-midia", reminders: "lembretes", outbox: "fila-envios", push: "push-alertas" } as const;

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
  await boss.schedule(QUEUES.rules, "* * * * *", null, { tz: "America/Bahia", singletonKey: "rules" });
  await boss.schedule(QUEUES.webhooks, "*/2 * * * *", null, { tz: "America/Bahia" });
  await boss.schedule(QUEUES.history, "* * * * *", null, { tz: "America/Bahia", singletonKey: "historico" });
  await boss.schedule(QUEUES.media, "* * * * *", null, { tz: "America/Bahia", singletonKey: "midia" });
  await boss.schedule(QUEUES.reminders, "*/5 * * * *", null, { tz: "America/Bahia", singletonKey: "lembretes" });
  await boss.schedule(QUEUES.outbox, "* * * * *", null, { tz: "America/Bahia", singletonKey: "fila-envios" });
  const pushOn = !!vapidConfig();
  if (pushOn) await boss.schedule(QUEUES.push, "* * * * *", null, { tz: "America/Bahia", singletonKey: "push" });
  else await boss.unschedule(QUEUES.push).catch(() => {});
  await boss.schedule(QUEUES.cleanup, "15 4 * * *", null, { tz: "America/Bahia" });
  // Retenção de mídia: todo dia às 04:00 de Salvador (America/Bahia, UTC-3 fixo; equivale a "0 7 * * *" em UTC). Lê a configuração a cada rodada; "nunca" não apaga nada.
  await boss.schedule(QUEUES.retention, "0 4 * * *", null, { tz: "America/Bahia", singletonKey: "retencao-midia" });

  // Batida do worker: gravada ao fim de cada rodada das regras (todo minuto), o que prova que o motor roda.
  // O /api/health lê daqui para saber se as automações estão funcionando.
  const beat = async () => {
    const now = new Date();
    await db.insert(settings).values({ key: "worker_heartbeat", value: now.toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value: now.toISOString(), updatedAt: now } });
  };
  await beat().catch((e) => console.error("[batida do worker]", e));

  await boss.work(QUEUES.rules, { batchSize: 1 }, async () => {
    const t = Date.now(); const s = await runRules();
    if (s.fired || s.errors.length) console.log(`[regras] ${s.fired} disparos, ${s.alerts} alertas, ${s.moved} movidos (${Date.now() - t} ms)`, s.errors);
    await beat().catch((e) => console.error("[batida do worker]", e));
  });
  await boss.work(QUEUES.webhooks, async () => { const r = await retryFailedWebhooks(); if (r.tried) console.log("[webhooks]", r); });
  // Histórico do WhatsApp ao conectar um número: um lote por vez até esvaziar.
  await boss.work(QUEUES.history, { batchSize: 1 }, async () => {
    for (let i = 0; i < 50; i++) { const r = await processHistoryEvents(5); if (r.lotes) console.log("[histórico]", r); if (r.lotes < 5) break; }
  });
  // Fotos, áudios e figurinhas: baixa logo (o link do WhatsApp expira) + fotos de perfil.
  await boss.work(QUEUES.media, { batchSize: 1 }, async () => {
    await checkConnections().catch((e) => console.error("[vigia da conexão]", e));
    const m = await downloadPendingMedia(30); const a = await refreshAvatars(15);
    if (m.tried || a.tried) console.log("[mídia]", m, "[fotos de perfil]", a);
  });
  // Tarefas que vencem nos próximos 15 min: um aviso para o responsável.
  await boss.work(QUEUES.reminders, { batchSize: 1 }, async () => { const r = await remindDueTasks(); if (r.alerts) console.log("[lembretes]", r); });
  // Fila de envios automáticos (lembretes, enquete D-1, resposta fora do horário): teto por hora e reconferências na hora de enviar.
  await boss.work(QUEUES.outbox, { batchSize: 1 }, async () => { const r = await drainOutbox(); if (r.sent || r.cancelled || r.retry || r.failed) console.log("[fila de envios]", r); });
  // Push no celular: só com as chaves VAPID no .env (sem elas o job nem é agendado).
  if (pushOn) await boss.work(QUEUES.push, { batchSize: 1 }, async () => { const r = await sendPushForPendingAlerts(); if (r.sent || r.failed) console.log("[push]", r); });
  await boss.work(QUEUES.retention, { batchSize: 1 }, async () => { const r = await purgeExpiredMedia(new Date(), await getMediaRetentionMonths()); if (r.purged) console.log("[retenção de mídia]", r); });
  await boss.work(QUEUES.cleanup, async () => { await purgeExpiredSessions(); await purgeOldWebhookEvents(); });

  // Primeira rodada imediata (sem esperar o próximo minuto cheio).
  await boss.send(QUEUES.rules, {});
  console.log("Worker do CRM rodando. Automações a cada minuto.");

  const stop = async () => { console.log("Encerrando worker…"); await boss.stop({ graceful: true, timeout: 10_000 }); await pool.end(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
