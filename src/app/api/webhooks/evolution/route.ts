import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { checkSecret, ingestEvolution, type EvoPayload } from "@/server/whatsapp/webhook";

export async function POST(req: NextRequest) {
  if (!checkSecret(req.headers.get("x-webhook-secret"), env().WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let payload: EvoPayload;
  try { payload = (await req.json()) as EvoPayload; } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  try {
    const r = await ingestEvolution(payload);
    return NextResponse.json(r);
  } catch (e) {
    console.error("[webhook evolution]", e);
    // 200 mesmo com erro: o evento ficou salvo e o worker reprocessa; evita a Evolution reenviar em loop.
    return NextResponse.json({ ok: false, queued: true });
  }
}
