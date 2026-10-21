import type { NextRequest } from "next/server";
import { can, type Perm } from "@/lib/permissions";
import { findSessionUser, type SessionUser } from "./sessions-store";

export const SESSION_EXPIRED_TEXT = "Sua sessão expirou. Entre de novo.";
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/**
 * Rotas de API que o painel chama no lugar de Server Actions: a mesma checagem das actions (sessão + permissão), com o texto para a tela
 * no corpo ({ ok: false, error }) e o status certo. `denied` é o texto de quando falta a permissão (a action mostrava o seu texto genérico).
 */
export async function routeUser(req: NextRequest, perm: Perm, denied: string): Promise<{ user: SessionUser; fail?: never } | { fail: Response; user?: never }> {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return { fail: json({ ok: false, error: SESSION_EXPIRED_TEXT }, 401) };
  if (!can(user.perms, perm)) return { fail: json({ ok: false, error: denied }, 403) };
  return { user };
}

/** POST que muda estado: só do próprio site (o cookie é SameSite=Lax; isto fecha o resto, como a checagem de origem das actions). */
export const crossSite = (req: NextRequest) => req.headers.get("sec-fetch-site") === "cross-site";
