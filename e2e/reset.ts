import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { seed } from "../src/server/db/seed";
import { settings, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";

// Banco de e2e limpo: gestão + uma atendente.
async function main() {
  if (!process.env.DATABASE_URL?.includes("crm_e2e")) throw new Error("reset só roda no banco crm_e2e");
  await db.execute(sql`truncate table automation_runs, automation_versions, automations, alerts, deal_events, messages, deals,
    contacts, channels, lists, stages, sessions, users, webhook_events, audit_log, settings, outbox, tasks, lead_sources, push_subscriptions restart identity cascade`);
  await seed(db);
  await db.insert(users).values([
    { name: "Thaíse Fiaes", email: "gestao@e2e.local", role: "gestor", passwordHash: await hashPassword("senha-e2e-123") },
    { name: "Ana Souza", email: "ana@e2e.local", role: "atendente", passwordHash: await hashPassword("senha-e2e-123") },
  ]);
  // Expediente 24h: os testes não dependem da hora em que rodam (o motor não dispara com a Casa fechada).
  const allDay: [string, string] = ["00:00", "24:00"];
  await db.insert(settings).values({ key: "business_hours", value: { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay } });
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
