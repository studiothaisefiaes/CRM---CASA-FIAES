import { monitorEventLoopDelay } from "node:perf_hooks";

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/server/db";
import { channels, outbox, settings } from "@/server/db/schema";
import { notRemovedChannel } from "@/server/whatsapp/channel-removed";

export type Health = {
  status: "ok" | "degraded" | "down";
  db: boolean;
  worker: { ok: boolean; lastBeatAt: string | null };
  whatsapp: { name: string; status: string }[];
  /** Só informam (o teto por hora, o modo quieto e o horário seguram envios de propósito): esperando e o mais atrasado, em minutos. */
  outbox?: { pending: number; overdueMinutes: number | null };
  /** Quanto o servidor demorou para atender (p99 do atraso do event loop desde a última consulta), em ms. Acima de ~200 a tela trava. */
  eventLoopP99Ms?: number;
};

const g = globalThis as unknown as { __crmLoopDelay?: IntervalHistogram };
function loopDelay(): IntervalHistogram {
  if (!g.__crmLoopDelay) { g.__crmLoopDelay = monitorEventLoopDelay({ resolution: 20 }); g.__crmLoopDelay.enable(); }
  return g.__crmLoopDelay;
}

/** O worker grava a batida a cada minuto; passou disso, considera parado. */
const WORKER_MAX_AGE_MS = 3 * 60_000;

/** A última batida do worker e se ela está em dia (até 3 min). Sem batida nenhuma: `lastBeatAt` null e `ok` false. */
export async function readWorkerBeat(now = Date.now()): Promise<{ lastBeatAt: string | null; ok: boolean }> {
  const [beat] = await db.select().from(settings).where(eq(settings.key, "worker_heartbeat"));
  const raw = typeof beat?.value === "string" ? beat.value : null;
  const t = raw ? Date.parse(raw) : NaN;
  return { lastBeatAt: Number.isNaN(t) ? null : new Date(t).toISOString(), ok: !Number.isNaN(t) && now - t < WORKER_MAX_AGE_MS };
}

export async function getHealth(now = Date.now()): Promise<Health> {
  try { await pool.query("select 1"); }
  catch (e) {
    console.error("[health] banco fora do ar", e instanceof Error ? e.message : e);
    return { status: "down", db: false, worker: { ok: false, lastBeatAt: null }, whatsapp: [] };
  }

  const { lastBeatAt, ok: workerOk } = await readWorkerBeat(now);

  const rows = await db.select({ name: channels.name, status: channels.status }).from(channels).where(notRemovedChannel).orderBy(channels.createdAt);
  const [ob] = await db.select({ pending: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${outbox.notBefore}) filter (where ${outbox.notBefore} <= ${new Date(now).toISOString()}::timestamptz)` })
    .from(outbox).where(eq(outbox.status, "pending"));
  const h = loopDelay();
  const eventLoopP99Ms = Math.round(h.percentile(99) / 1e6);
  h.reset();
  const whatsappBad = rows.some((c) => c.status !== "conectado");

  return {
    status: workerOk && !whatsappBad ? "ok" : "degraded",
    db: true,
    worker: { ok: workerOk, lastBeatAt },
    whatsapp: rows,
    outbox: { pending: ob?.pending ?? 0, overdueMinutes: ob?.oldest ? Math.floor((now - Date.parse(ob.oldest)) / 60_000) : null },
    eventLoopP99Ms,
  };
}
