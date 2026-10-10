import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { subscribe } from "@/server/realtime";
import { scopesOf } from "@/lib/live-scope";

export const maxDuration = 3600;

/** Garante o escopo no aviso (um NOTIFY direto no banco, sem `emit`, também é roteado). Fora do formato: repassa como veio. */
function withScope(payload: string): string {
  try {
    const e = JSON.parse(payload);
    if (!e || typeof e !== "object" || typeof e.type !== "string") return payload;
    if (Array.isArray(e.scope) || typeof e.scope === "string") return payload;
    return JSON.stringify({ ...e, scope: scopesOf(e) });
  } catch { return payload; }
}

// Server-Sent Events: repassa os avisos do Postgres (um LISTEN por processo) para as telas abertas.
// Não segura conexão do pool: dezenas de abas abertas não afetam o resto do app.
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (s: string) => { if (!closed) try { controller.enqueue(enc.encode(s)); } catch { closed = true; } };
      const unsubscribe = subscribe((payload) => send(`data: ${withScope(payload)}\n\n`));
      send(`retry: 3000\ndata: {"type":"conectado"}\n\n`);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); try { controller.close(); } catch {} };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
