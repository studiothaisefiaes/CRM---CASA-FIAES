import type { NextRequest } from "next/server";
import { crossSite, routeUser } from "@/server/auth/route-user";
import { emit } from "@/server/domain/events";
import { isUuid } from "@/lib/uuid";
import { OUT_OF_SCOPE } from "@/server/domain/deal-scope";
import { canActOn } from "@/server/queries/conversation";
import { displayName } from "@/lib/display-name";

export const dynamic = "force-dynamic";
const ERROR = "Não deu certo. Tente de novo.";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * "Fulana está escrevendo…" (colisão, pesquisa 20/10): quem digita na conversa avisa as outras telas abertas nela.
 * Não guarda nada e nunca recebe o texto: só repassa quem e em qual conversa, pelo tempo real (escopo `escrevendo:<id>`).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (crossSite(req)) return json({ ok: false, error: ERROR }, 403);
  const auth = await routeUser(req, "atendimento.ver", "Você não tem permissão para isso.");
  if (auth.fail) return auth.fail;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ ok: false, error: ERROR }, 400);
  if (!(await canActOn(auth.user, id))) return json({ ok: false, error: OUT_OF_SCOPE }, 403);
  await emit("escrevendo", { dealId: id, userId: auth.user.id, nome: displayName(auth.user.name.trim().split(/\s+/)[0] ?? auth.user.name) });
  return json({ ok: true });
}
