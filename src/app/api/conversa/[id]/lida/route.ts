import type { NextRequest } from "next/server";
import { crossSite, routeUser } from "@/server/auth/route-user";
import { markConversationRead } from "@/server/domain/send";
import { isPeek, markSeen } from "@/server/domain/seen";
import { isUuid } from "@/lib/uuid";
import { OUT_OF_SCOPE } from "@/server/domain/deal-scope";
import { canActOn } from "@/server/queries/conversation";

export const dynamic = "force-dynamic";
const ERROR = "Não deu certo. Tente de novo.";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** O "lido" da conversa aberta, fora da fila das Server Actions: o painel chama depois de mostrar a conversa. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (crossSite(req)) return json({ ok: false, error: ERROR }, 403);
  const auth = await routeUser(req, "atendimento.ver", "Você não tem permissão para isso.");
  if (auth.fail) return auth.fail;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ ok: false, error: ERROR }, 400);
  // M1 (17/10): a conversa de uma colega não fica "vista" por quem só vê as próprias.
  if (!(await canActOn(auth.user, id))) return json({ ok: false, error: OUT_OF_SCOPE }, 403);
  void markConversationRead(id, auth.user.id);
  // A gestão espiando a conversa de uma atendente não tira o "não lida" dela (isPeek).
  if (await isPeek(auth.user, id)) return json({ ok: true, espiando: true });
  void markSeen(id, auth.user.id).catch((e) => console.error("[visto] não marcou", id, e instanceof Error ? e.message : e));
  return json({ ok: true });
}
