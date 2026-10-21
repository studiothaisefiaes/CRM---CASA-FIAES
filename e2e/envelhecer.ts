import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { runRules } from "../src/server/rules/engine";
import { offerOverdue } from "../src/server/domain/offers";

// Uso (só e2e): tsx e2e/envelhecer.ts +5571991234567 3  → volta a espera do lead em 3 min e roda as automações (e as ofertas da distribuição).
async function main() {
  if (!process.env.DATABASE_URL?.includes("crm_e2e")) throw new Error("só roda no banco crm_e2e");
  const [phone, minutes] = process.argv.slice(2);
  await db.execute(sql`update deals set awaiting_reply_since = now() - make_interval(mins => ${Number(minutes)})
    where contact_id = (select id from contacts where phone_e164 = ${phone})`);
  console.log(await runRules());
  console.log(await offerOverdue()); // como o worker: depois do motor, as ofertas da distribuição (só faz algo se ela estiver ligada)
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
