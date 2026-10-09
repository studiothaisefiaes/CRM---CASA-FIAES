import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __crmPool?: Pool };

export const pool =
  globalForDb.__crmPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
if (process.env.NODE_ENV !== "production") globalForDb.__crmPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

/** Avisa a interface (SSE) que algo mudou. Payload pequeno: tipo + ids. */
export async function notify(payload: { type: string; dealId?: string; userId?: string | null; [k: string]: unknown }) {
  await pool.query("select pg_notify('crm_events', $1)", [JSON.stringify(payload)]);
}
