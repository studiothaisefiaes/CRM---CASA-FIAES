import type { NextRequest } from "next/server";
import { clientIp } from "@/server/auth/client-ip";
import { icsForToken } from "@/server/domain/client-link/links";

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

/** "Salvar na agenda": o .ics da visita, só com o token do link. Sem o nome da cliente. Link inválido: 404 genérico. */
export async function GET(req: NextRequest, ctx: RouteContext<"/c/[token]/agenda.ics">) {
  const { token } = await ctx.params;
  const ics = await icsForToken(token, { ip: clientIp(req.headers) });
  if (!ics) return new Response("Este link não vale mais.", { status: 404, headers: NO_STORE });
  return new Response(ics, { headers: { ...NO_STORE, "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="casa-fiaes.ics"' } });
}
