import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { profiles, sessions, users } from "../db/schema";
import { isPerm, type Perm } from "@/lib/permissions";
import { hashToken, newToken } from "./tokens";

export const SESSION_DAYS = 30;

/** Sessão de quem só tem o app da profissional: 90 dias, renovada a cada abertura (login caindo é a queixa nº 1 do Avec PRO). */
export const PRO_SESSION_DAYS = 90;

/** Estende a sessão para `now + days` sem nunca encurtar. Devolve a validade nova, ou null se a sessão não existe ou venceu. */
export async function renewSession(token: string, now: Date, days: number): Promise<Date | null> {
  const target = new Date(now.getTime() + days * 86_400_000);
  const [row] = await db.update(sessions)
    .set({ expiresAt: sql`greatest(${sessions.expiresAt}, ${target.toISOString()}::timestamptz)` })
    .where(and(eq(sessions.idHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .returning({ expiresAt: sessions.expiresAt });
  return row?.expiresAt ?? null;
}

export async function insertSession(userId: string, now = new Date()) {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ idHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export type SessionUser = { id: string; name: string; email: string; profileId: string | null; profileName: string; perms: Perm[]; availability: string };

/** Lê o perfil a cada chamada (sem cache entre requisições): trocar o perfil de alguém vale na próxima navegação. */
export async function findSessionUser(token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active, availability: users.availability, profileId: users.profileId, profileName: profiles.name, permissions: profiles.permissions })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(profiles, eq(profiles.id, users.profileId))
    .where(and(eq(sessions.idHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const u = rows[0];
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, profileId: u.profileId, profileName: u.profileName ?? "Sem perfil", perms: (u.permissions ?? []).filter(isPerm), availability: u.availability };
}

/**
 * Para as rotas de foto e mídia (uma conversa pede dezenas de imagens de uma vez): a mesma sessão lida há menos de `SESSION_CACHE_MS`
 * não vai ao banco de novo. Sair (`deleteSession`) apaga na hora; trocar o perfil de alguém vale nessas rotas em até 5 s.
 * Só sessão válida fica guardada (token inválido sempre consulta o banco).
 */
export const SESSION_CACHE_MS = 5_000;
const SESSION_CACHE_MAX = 500;
const sessionCache = new Map<string, { user: SessionUser; until: number }>();
export async function findSessionUserCached(token: string | undefined, now = Date.now()): Promise<SessionUser | null> {
  if (!token) return null;
  const key = hashToken(token);
  const hit = sessionCache.get(key);
  if (hit && hit.until > now) return hit.user;
  const user = await findSessionUser(token, new Date(now));
  if (!user) { sessionCache.delete(key); return null; }
  if (sessionCache.size >= SESSION_CACHE_MAX) for (const [k, v] of sessionCache) if (v.until <= now || sessionCache.size >= SESSION_CACHE_MAX) sessionCache.delete(k); else break;
  sessionCache.set(key, { user, until: now + SESSION_CACHE_MS });
  return user;
}
/** Só testes: esquece as sessões guardadas. */
export const __clearSessionCache = () => sessionCache.clear();

export async function deleteSession(token: string) {
  sessionCache.delete(hashToken(token));
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(token)));
}

export async function purgeExpiredSessions(now = new Date()) {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
