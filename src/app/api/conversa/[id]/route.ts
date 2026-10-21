import type { NextRequest } from "next/server";
import { routeUser } from "@/server/auth/route-user";
import { CONVERSATION_ERROR, CONVERSATION_GONE, conversationFor } from "@/server/queries/conversation";
import { stringifyWithDates } from "@/lib/json-dates";
import { isUuid } from "@/lib/uuid";
import { OUT_OF_SCOPE } from "@/server/domain/deal-scope";

export const dynamic = "force-dynamic";
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };

/**
 * A conversa do painel da Fila (o mesmo conteúdo de `getConversationAction`), por GET: não entra na fila das Server Actions,
 * então abrir uma conversa nunca espera um envio, um "lido" ou um refresh da lista. As datas vão como {"$d": iso} (lib/json-dates).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await routeUser(req, "atendimento.ver", CONVERSATION_ERROR);
  if (auth.fail) return auth.fail;
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response(stringifyWithDates({ ok: false, error: CONVERSATION_ERROR }), { status: 400, headers });
  try {
    const r = await conversationFor(auth.user, id);
    return new Response(stringifyWithDates(r), { status: r.ok ? 200 : r.error === CONVERSATION_GONE ? 404 : r.error === OUT_OF_SCOPE ? 403 : 400, headers });
  } catch (e) {
    console.error("[conversa]", id, e instanceof Error ? e.message : e);
    return new Response(stringifyWithDates({ ok: false, error: CONVERSATION_ERROR }), { status: 500, headers });
  }
}
