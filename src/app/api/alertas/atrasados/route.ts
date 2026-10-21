import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { countLateLeads } from "@/server/queries/late-count";

/** Quantos leads estão atrasados para quem pediu. O LateWatch consulta isto nos eventos ao vivo, mesmo com a aba em segundo plano. */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return Response.json({ error: "não autorizado" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ n: await countLateLeads(user) }, { headers: { "cache-control": "no-store" } });
}
