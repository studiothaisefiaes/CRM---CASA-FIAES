import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, profiles, users } from "../db/schema";
import { isProOnly } from "@/lib/permissions";
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

export async function createInvite(input: { name: string; email: string; role: "gestor" | "atendente"; profileId?: string; /** Só para quem ainda não existe. */ signature?: string | null }) {
  const token = newToken();
  const inviteExpiresAt = new Date(Date.now() + 7 * 86_400_000);
  const existing = await findUserByEmail(input.email);
  if (existing?.passwordHash) throw new Error("Já existe uma pessoa com esse e-mail.");
  if (existing) {
    await db.update(users).set({ name: input.name, role: input.role, ...(input.profileId ? { profileId: input.profileId } : {}), inviteTokenHash: hashToken(token), inviteExpiresAt, active: true })
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

const INVITE_GONE = "Este convite expirou ou já foi usado. Peça um novo à gestão.";

export async function acceptInvite(token: string, password: string) {
  if (!isValidPassword(password)) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  // Confere o token antes do argon2 (caro): token inválido ou vencido não gasta CPU.
  if (!(await findInvite(token))) throw new Error(INVITE_GONE);
  const passwordHash = await hashPassword(password);
  // Atômico: só um aceite por convite, mesmo com dois cliques simultâneos.
  const [u] = await db.update(users).set({ passwordHash, inviteTokenHash: null, inviteExpiresAt: null })
    .where(and(eq(users.inviteTokenHash, hashToken(token)), gt(users.inviteExpiresAt, new Date()))).returning();
  if (!u) throw new Error(INVITE_GONE);
  // "Entrou em 16/10" (Configurações › Profissionais › Acesso ao app).
  await db.insert(auditLog).values({ userId: u.id, action: "aceitou_convite", entity: "user", entityId: u.id });
  return u;
}

/** Depois de criar a senha: quem só tem o app da profissional cai no passo a passo de instalação; os demais, no Hoje. */
export async function inviteLanding(userId: string): Promise<string> {
  const [r] = await db.select({ permissions: profiles.permissions }).from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  return isProOnly(r?.permissions ?? []) ? "/pro/instalar" : "/";
}
