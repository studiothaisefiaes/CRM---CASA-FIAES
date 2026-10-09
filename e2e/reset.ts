import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { seed } from "../src/server/db/seed";
import { users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";

// Banco de e2e limpo: gestão + uma atendente.
async function main() {
  if (!process.env.DATABASE_URL?.includes("crm_e2e")) throw new Error("reset só roda no banco crm_e2e");
  await db.execute(sql`truncate table automation_runs, automation_versions, automations, alerts, deal_events, messages, deals,
    contacts, channels, lists, stages, sessions, users, webhook_events, audit_log restart identity cascade`);
  await seed(db);
  await db.insert(users).values([
    { name: "Thaíse Fiaes", email: "gestao@e2e.local", role: "gestor", passwordHash: await hashPassword("senha-e2e-123") },
    { name: "Ana Souza", email: "ana@e2e.local", role: "atendente", passwordHash: await hashPassword("senha-e2e-123") },
  ]);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
