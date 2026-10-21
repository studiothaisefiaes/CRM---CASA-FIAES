import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { eventLog } from "@/server/realtime";
import { viewerEvent } from "@/lib/live-scope";
import { beatForToken } from "@/server/domain/presence";
import { PRESENCE_BEAT_MS } from "@/server/domain/distribution";

export const dynamic = "force-dynamic";
const HOLD_MS = 25_000;
const lastBeat = new Map<string, number>();

const parse = (p: string) => { try { return JSON.parse(p); } catch { return null; } };

// Long-polling: o mesmo tempo real do /api/stream, para quando o stream fica preso no caminho (túnel/proxy).
// Sem `after`: devolve o cursor atual. Com `after`: responde assim que chegar aviso novo (ou vazio em 25 s).
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const user = await findSessionUser(token);
  if (!user || !token) return new Response("não autorizado", { status: 401 });
  // Presença (distribuição): o CRM aberto conta como sinal, no mesmo ritmo do SSE.
  const now = Date.now();
  if (now - (lastBeat.get(token) ?? 0) >= PRESENCE_BEAT_MS) {
    lastBeat.set(token, now);
    beatForToken(token).catch((e) => console.error("[presença]", e));
  }
  const log = eventLog();
  const raw = req.nextUrl.searchParams.get("after");
  const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
  if (raw === null) return new Response(JSON.stringify({ cursor: log.cursor(), events: [] }), { headers });
  const after = Number(raw);
  if (!Number.isInteger(after) || after < 0) return new Response("cursor inválido", { status: 400 });
  const r = await log.wait(after, HOLD_MS, req.signal);
  const events = r.gap ? [{ type: "reconectado" }] : r.events.map((p) => viewerEvent(p, user.perms)).filter((s): s is string => s !== null).map(parse).filter(Boolean);
  return new Response(JSON.stringify({ cursor: r.cursor, events }), { headers });
}
