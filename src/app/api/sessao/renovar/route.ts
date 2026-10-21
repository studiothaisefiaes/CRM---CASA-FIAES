import { cookies } from "next/headers";
import { findSessionUser, PRO_SESSION_DAYS, renewSession, SESSION_DAYS } from "@/server/auth/sessions-store";
import { SESSION_COOKIE } from "@/server/auth/session";
import { secureSessionCookie } from "@/server/auth/cookie";
import { env } from "@/server/env";
import { isProOnly } from "@/lib/permissions";

/**
 * O app da profissional chama ao abrir, no máximo uma vez por dia. A sessão vai para agora + 90 dias (só o app) ou + 30 (os demais),
 * e o cookie é gravado de novo com a validade nova. Exige sessão; não devolve dado de cliente.
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const user = await findSessionUser(token);
  if (!user || !token) return new Response("não autorizado", { status: 401 });
  const expiresAt = await renewSession(token, new Date(), isProOnly(user.perms) ? PRO_SESSION_DAYS : SESSION_DAYS);
  if (!expiresAt) return new Response("não autorizado", { status: 401 });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: secureSessionCookie({ nodeEnv: process.env.NODE_ENV, demo: env().DEMO }), sameSite: "lax", path: "/", expires: expiresAt,
  });
  return Response.json({ ok: true, expiresAt: expiresAt.toISOString() }, { headers: { "cache-control": "no-store" } });
}
