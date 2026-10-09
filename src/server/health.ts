import { eq } from "drizzle-orm";
import { db, pool } from "@/server/db";
import { channels, settings } from "@/server/db/schema";
import { notRemovedChannel } from "@/server/whatsapp/channel-removed";

export type Health = {
  status: "ok" | "degraded" | "down";
  db: boolean;
  worker: { ok: boolean; lastBeatAt: string | null };
  whatsapp: { name: string; status: string }[];
};

/** O worker grava a batida a cada minuto; passou disso, considera parado. */
const WORKER_MAX_AGE_MS = 3 * 60_000;

export async function getHealth(now = Date.now()): Promise<Health> {
  try { await pool.query("select 1"); }
  catch { return { status: "down", db: false, worker: { ok: false, lastBeatAt: null }, whatsapp: [] }; }

  const [beat] = await db.select().from(settings).where(eq(settings.key, "worker_heartbeat"));
  const raw = typeof beat?.value === "string" ? beat.value : null;
  const t = raw ? Date.parse(raw) : NaN;
  const lastBeatAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  const workerOk = !Number.isNaN(t) && now - t < WORKER_MAX_AGE_MS;

  const rows = await db.select({ name: channels.name, status: channels.status }).from(channels).where(notRemovedChannel).orderBy(channels.createdAt);
  const whatsappBad = rows.some((c) => c.status !== "conectado");

  return {
    status: workerOk && !whatsappBad ? "ok" : "degraded",
    db: true,
    worker: { ok: workerOk, lastBeatAt },
    whatsapp: rows,
  };
}
