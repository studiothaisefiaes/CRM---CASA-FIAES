import type { NextRequest } from "next/server";
import { pool } from "@/server/db";
import { findSessionUser } from "@/server/auth/sessions-store";

export const maxDuration = 3600;

// Server-Sent Events: repassa os avisos do Postgres (LISTEN crm_events) para as telas abertas.
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const client = await pool.connect();
  const enc = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { if (!closed) controller.enqueue(enc.encode(s)); };
      const onNotify = (msg: { channel: string; payload?: string }) => { if (msg.channel === "crm_events") send(`data: ${msg.payload ?? "{}"}\n\n`); };
      client.on("notification", onNotify);
      await client.query("LISTEN crm_events");
      send(`retry: 3000\ndata: {"type":"conectado"}\n\n`);
      heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      const cleanup = async () => {
        if (closed) return; closed = true;
        clearInterval(heartbeat);
        client.off("notification", onNotify);
        try { await client.query("UNLISTEN crm_events"); } catch {}
        client.release();
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener("abort", cleanup);
    },
    async cancel() { closed = true; clearInterval(heartbeat); try { await client.query("UNLISTEN crm_events"); } catch {} client.release(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
