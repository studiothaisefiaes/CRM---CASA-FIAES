import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteSession, findSessionUser, insertSession, type SessionUser } from "./sessions-store";
import { secureSessionCookie } from "./cookie";
import { env } from "../env";
import { can, firstAllowedPath, type Perm } from "@/lib/permissions";
import { UserFacingError } from "../domain/errors";

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

/** Página que exige uma permissão: sem ela, volta para o Hoje com o aviso "sem permissão". */
export async function requirePerm(perm: Perm): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.perms, perm)) redirect(`${firstAllowedPath(user.perms)}?aviso=sem-permissao`);
  return user;
}

/** Página que aceita qualquer uma das permissões (ex.: Configurações abre para quem edita ou para quem gere a equipe). */
export async function requireAnyPerm(...perms: Perm[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!perms.some((p) => can(user.perms, p))) redirect(`${firstAllowedPath(user.perms)}?aviso=sem-permissao`);
  return user;
}

/** Para Server Actions e rotas: só exige estar logado. Lança erro em vez de redirecionar. */
export async function assertUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UserFacingError("Sua sessão expirou. Entre de novo.");
  return user;
}

/** Para Server Actions: aceita qualquer uma das permissões (ex.: mover lead vale no Atendimento e no Quadro). */
export async function assertAnyPerm(...perms: Perm[]): Promise<SessionUser> {
  const user = await assertUser();
  if (!perms.some((p) => can(user.perms, p))) throw new UserFacingError("Você não tem permissão para isso.");
  return user;
}

/** Para Server Actions e rotas: exige a permissão no servidor (esconder o botão não basta). */
export async function assertPerm(perm: Perm): Promise<SessionUser> {
  const user = await assertUser();
  if (!can(user.perms, perm)) throw new UserFacingError("Você não tem permissão para isso.");
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
}

export type { SessionUser };
