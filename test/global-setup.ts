import "dotenv/config";
import { execSync } from "node:child_process";

export default function setup() {
  const url = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_test$1");
  execSync("npx drizzle-kit migrate", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
