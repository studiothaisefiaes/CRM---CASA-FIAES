import { NextResponse } from "next/server";
import { getHealth } from "@/server/health";

export const dynamic = "force-dynamic";

/** 200 em ok e degraded (o app serve); 503 só quando o banco está fora. */
export async function GET() {
  const h = await getHealth().catch((e: unknown) => { console.error("[health] falhou ao montar a saúde", e instanceof Error ? e.message : e); return null; });
  if (!h) return NextResponse.json({ status: "down", db: false }, { status: 503 });
  return NextResponse.json(h, { status: h.status === "down" ? 503 : 200 });
}
