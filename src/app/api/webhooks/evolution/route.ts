import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { checkSecret, ingestEvolution, type EvoPayload } from "@/server/whatsapp/webhook";

export async function POST(req: NextRequest) {
  if (!checkSecret(req.headers.get("x-webhook-secret"), env().WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let payload: EvoPayload;
  const len = Number(req.headers.get("content-length") ?? 0);
  // O histórico chega em lotes de até ~5 mil mensagens; acima disso é algo errado.
  if (len > 100_000_000) return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
  try { payload = (await req.json()) as EvoPayload; } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  try {
    const r = await ingestEvolution(payload);
    return NextResponse.json(r);
  } catch (e) {
    // Não conseguiu nem gravar o evento (banco fora, disco cheio): 503 para a Evolution reenviar depois.
    console.error("[webhook evolution] evento não gravado", e);
    return NextResponse.json({ ok: false, error: "indisponível" }, { status: 503 });
  }
}
