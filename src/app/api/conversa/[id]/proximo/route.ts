import type { NextRequest } from "next/server";
import { routeUser } from "@/server/auth/route-user";
import { nextWaitingFor } from "@/server/queries/conversation";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";
const ERROR = "Não foi possível buscar o próximo da fila.";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** "Próximo da fila" depois de enviar (o mesmo de `nextWaitingAction`), por GET: não espera nem atrasa outras Server Actions. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await routeUser(req, "atendimento.ver", ERROR);
  if (auth.fail) return auth.fail;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ ok: false, error: ERROR }, 400);
  try { return json(await nextWaitingFor(auth.user, id)); } catch (e) {
    console.error("[próximo da fila]", id, e instanceof Error ? e.message : e);
    return json({ ok: false, error: ERROR }, 500);
  }
}
