import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { allow } from "@/server/auth/rate-limit";
import { checkSecret, ingestEvolution, type EvoPayload } from "@/server/whatsapp/webhook";

export const WEBHOOK_MAX_PER_MIN = 600;

export async function POST(req: NextRequest) {
  if (!checkSecret(req.headers.get("x-webhook-secret"), env().WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let payload: EvoPayload;
  const len = Number(req.headers.get("content-length") ?? 0);
  // O histórico chega em lotes de até ~5 mil mensagens; acima disso é algo errado.
  if (len > 100_000_000) return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
  try { payload = (await req.json()) as EvoPayload; } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  // Limite por instância (em memória): acima de 600 req/min responde 429 e a Evolution reenvia depois.
  if (!allow(`webhook:${payload.instance ?? "?"}`, WEBHOOK_MAX_PER_MIN, 60_000)) {
    return NextResponse.json({ error: "muitas requisições" }, { status: 429, headers: { "retry-after": "30" } });
  }
  try {
    const r = await ingestEvolution(payload);
    return NextResponse.json(r);
  } catch (e) {
    // Não conseguiu nem gravar o evento (banco fora, disco cheio): 503 para a Evolution reenviar depois.
    console.error("[webhook evolution] evento não gravado", e);
    return NextResponse.json({ ok: false, error: "indisponível" }, { status: 503 });
  }
}
