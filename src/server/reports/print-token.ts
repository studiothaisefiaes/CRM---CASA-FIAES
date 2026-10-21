import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { profiles, reportPrintTokens, users } from "../db/schema";
import { hashToken, newToken } from "../auth/tokens";
import { isPerm, type Perm } from "@/lib/permissions";

export const PRINT_TOKEN_MS = 5 * 60_000;

/** Token de uso único para o Chromium do servidor abrir /relatorios/imprimir como `userId` (só o hash fica no banco). */
export async function issuePrintToken(userId: string, now: Date = new Date()): Promise<string> {
  const token = newToken();
  await db.insert(reportPrintTokens).values({ tokenHash: hashToken(token), userId, expiresAt: new Date(now.getTime() + PRINT_TOKEN_MS), createdAt: now });
  return token;
}

/** Usa o token (marca como usado na mesma operação) e devolve quem pediu, com as permissões de agora; vencido, usado ou de pessoa desativada: null. */
export async function consumePrintToken(token: string | undefined | null, now: Date = new Date()): Promise<{ id: string; name: string; perms: Perm[] } | null> {
  if (!token) return null;
  const [row] = await db.update(reportPrintTokens).set({ usedAt: now })
    .where(and(eq(reportPrintTokens.tokenHash, hashToken(token)), isNull(reportPrintTokens.usedAt), gt(reportPrintTokens.expiresAt, now)))
    .returning({ userId: reportPrintTokens.userId });
  if (!row) return null;
  const [u] = await db.select({ id: users.id, name: users.name, active: users.active, permissions: profiles.permissions })
    .from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, row.userId));
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, perms: (u.permissions ?? []).filter(isPerm) };
}
