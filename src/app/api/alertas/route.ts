import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { getMyAlerts } from "@/server/queries/alerts";

/**
 * Os avisos do sino de quem pediu (`getMyAlerts`: até 30, dos últimos 7 dias), sempre frescos e no escopo dele. O sino busca aqui quando chega
 * um evento ao vivo dos escopos `alerts` ou `queue` (todo evento de lead passa por `queue`), com debounce e sem router.refresh.
 */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return Response.json({ error: "não autorizado" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json(await getMyAlerts(user), { headers: { "cache-control": "no-store" } });
}
