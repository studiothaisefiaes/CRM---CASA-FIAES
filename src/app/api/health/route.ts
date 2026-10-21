import { NextResponse, type NextRequest } from "next/server";
import { getHealth } from "@/server/health";
import { findSessionUser } from "@/server/auth/sessions-store";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Os detalhes (banco, worker, cada número do WhatsApp) só para quem configura o sistema; o público vê só o status (revisão 17/10, B5). */
async function seesDetails(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("cf_session")?.value;
  if (!token) return false;
  try { return can((await findSessionUser(token))?.perms, "config.sistema"); } catch { return false; }
}

/** 200 em ok e degraded (o app serve); 503 só quando o banco está fora. */
export async function GET(req: NextRequest) {
  const h = await getHealth().catch((e: unknown) => { console.error("[health] falhou ao montar a saúde", e instanceof Error ? e.message : e); return null; });
  // Público: só o status (ok, degraded ou down), para o monitor externo ainda ver worker parado ou número caído; nada de nome nem horário.
  if (!(await seesDetails(req))) return NextResponse.json({ status: h?.status ?? "down" }, { status: !h || h.status === "down" ? 503 : 200 });
  if (!h) return NextResponse.json({ status: "down", db: false }, { status: 503 });
  return NextResponse.json(h, { status: h.status === "down" ? 503 : 200 });
}
