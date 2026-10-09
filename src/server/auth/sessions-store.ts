import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { hashToken, newToken } from "./tokens";

export const SESSION_DAYS = 30;

export async function insertSession(userId: string, now = new Date()) {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ idHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export type SessionUser = { id: string; name: string; email: string; role: "gestor" | "atendente" };

export async function findSessionUser(token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const u = rows[0];
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(token)));
}

export async function purgeExpiredSessions(now = new Date()) {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
