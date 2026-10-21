import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { subscribe } from "@/server/realtime";
import { viewerEvent } from "@/lib/live-scope";
import { beatForToken } from "@/server/domain/presence";
import { PRESENCE_BEAT_MS } from "@/server/domain/distribution";

export const maxDuration = 3600;

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
      const unsubscribe = subscribe((payload) => { const out = viewerEvent(payload, user.perms); if (out) send(`data: ${out}\n\n`); });
      send(`retry: 3000\ndata: {"type":"conectado"}\n\n`);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      // Presença (distribuição): o CRM aberto conta como sinal; ao conectar e a cada minuto. Falha aqui nunca derruba o stream.
      // A cada batida confere a sessão: depois de "Sair", a aba que ficou aberta para de ligar a pessoa e o stream fecha.
      const token = req.cookies.get("cf_session")?.value;
      const presence = () => { beatForToken(token).then((ok) => { if (!ok) cleanup(); }).catch((e) => console.error("[presença]", e)); };
      presence();
      const presenceTimer = setInterval(presence, PRESENCE_BEAT_MS);
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); clearInterval(presenceTimer); unsubscribe(); try { controller.close(); } catch {} };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
