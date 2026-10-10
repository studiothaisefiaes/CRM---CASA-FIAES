import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { getMyAlerts } from "@/server/queries/alerts";

/**
 * Os avisos do sino de quem pediu (os mesmos que o layout entrega ao abrir a tela), sempre frescos. O sino busca aqui nos eventos ao vivo
 * (alerts, queue, deal), sem router.refresh, então o número e a lista andam sem recarregar a página inteira.
 */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return Response.json({ error: "não autorizado" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json(await getMyAlerts(user), { headers: { "cache-control": "no-store" } });
}
