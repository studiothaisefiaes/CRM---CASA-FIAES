import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { hashPassword, isValidPassword, verifyPassword } from "./password";
import { hashToken, newToken } from "./tokens";

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email.trim()})`).limit(1);
  return rows[0] ?? null;
}

export async function checkCredentials(email: string, password: string) {
  const u = await findUserByEmail(email);
  // Verifica mesmo sem usuário para não revelar quais e-mails existem pelo tempo de resposta.
  const ok = await verifyPassword(u?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$Zm9vYmFyYmF6", password);
  if (!u || !ok || !u.active) return null;
  return u;
}

export async function createInvite(input: { name: string; email: string; role: "gestor" | "atendente" }) {
  const token = newToken();
  const inviteExpiresAt = new Date(Date.now() + 7 * 86_400_000);
  const existing = await findUserByEmail(input.email);
  if (existing?.passwordHash) throw new Error("Já existe uma pessoa com esse e-mail.");
  if (existing) {
    await db.update(users).set({ name: input.name, role: input.role, inviteTokenHash: hashToken(token), inviteExpiresAt, active: true })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ ...input, inviteTokenHash: hashToken(token), inviteExpiresAt });
  }
  return token;
}

export async function findInvite(token: string) {
  const rows = await db.select().from(users)
    .where(and(eq(users.inviteTokenHash, hashToken(token)), gt(users.inviteExpiresAt, new Date()))).limit(1);
  return rows[0] ?? null;
}

export async function acceptInvite(token: string, password: string) {
  if (!isValidPassword(password)) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  const u = await findInvite(token);
  if (!u) throw new Error("Este convite expirou ou já foi usado. Peça um novo à gestão.");
  await db.update(users).set({ passwordHash: await hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null })
    .where(eq(users.id, u.id));
  return u;
}
