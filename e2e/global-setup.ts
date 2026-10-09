import "dotenv/config";
import { execSync } from "node:child_process";

export default function globalSetup() {
  const url = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx drizzle-kit migrate", { env, stdio: "inherit" });
  execSync(`npx tsx e2e/reset.ts`, { env, stdio: "inherit" });
}
