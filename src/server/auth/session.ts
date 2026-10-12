import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteSession, findSessionUser, insertSession, type SessionUser } from "./sessions-store";
import { secureSessionCookie } from "./cookie";
import { env } from "../env";

export const SESSION_COOKIE = "cf_session";

export async function createSession(userId: string) {
  const { token, expiresAt } = await insertSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: secureSessionCookie({ nodeEnv: process.env.NODE_ENV, demo: env().DEMO }), sameSite: "lax", path: "/", expires: expiresAt,
  });
}

/** Lê a sessão uma vez por request (cache do React). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findSessionUser(token);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireGestor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "gestor") redirect("/?aviso=sem-permissao");
  return user;
}

/** Para Server Actions: lança erro em vez de redirecionar. */
export async function assertUser(role?: "gestor"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sua sessão expirou. Entre de novo.");
  if (role && user.role !== role) throw new Error("Só a gestão pode fazer isso.");
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
}

export type { SessionUser };
