import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { seed } from "@/server/db/seed";

/** Limpa os dados (mantém o schema) e reaplica o seed padrão. */
export async function resetDb() {
  await db.execute(sql`truncate table automation_runs, automation_versions, automations, alerts, deal_events, messages, deals,
    contacts, channels, lists, stages, sessions, users, webhook_events, audit_log, settings, outbox, tasks, lead_sources, push_subscriptions restart identity cascade`);
  await seed(db);
}
