import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { auditLog, openInvites, profiles, users } from "../db/schema";
import { legacyRoleOf } from "@/lib/permissions";
import { hashPassword, isValidPassword, PASSWORD_RULE } from "../auth/password";
import { hashToken, newToken } from "../auth/tokens";
import { UserFacingError } from "./errors";
import { assertActorCanAssignProfile, isPrivileged } from "./profiles";

/**
 * Link do contador (pedido do dono, 26/10): a gestão (equipe.gerir) gera um link de uso único, válido por 7 dias, amarrado ao perfil
 * Contador e a nenhum e-mail. Quem abre põe nome, e-mail e senha e entra com o perfil Contador; o link deixa de valer. Só o hash do link
 * fica no banco (como o convite de sempre) e gerar, revogar e usar ficam na auditoria. Nunca vale para um perfil que gere a equipe.
 */
export const CONTADOR_LINK_DAYS = 7;
export const CONTADOR_LINK_GONE = "Este link expirou, já foi usado ou foi cancelado. Peça um novo à gestão da Casa.";
/** E-mail repetido: diz só isso (não diz de quem é nem se a pessoa está ativa). */
export const CONTADOR_EMAIL_TAKEN = "Já existe um acesso com esse e-mail. Use outro e-mail ou fale com a gestão da Casa.";

const contadorProfile = async () => (await db.select().from(profiles).where(eq(profiles.key, "contador")))[0] ?? null;
const valid = (now: Date) => and(isNull(openInvites.usedAt), isNull(openInvites.revokedAt), gt(openInvites.expiresAt, now));

export async function createContadorLink(actorId: string, now: Date = new Date()): Promise<{ id: string; token: string; expiresAt: Date }> {
  const p = await contadorProfile();
  if (!p) throw new UserFacingError("O perfil Contador não existe. Fale com o suporte do CRM.");
  if (isPrivileged(p)) throw new UserFacingError("O perfil Contador não pode gerir a equipe. Tire \"Gerir equipe e perfis\" dele em Perfis de acesso antes de gerar o link.");
  await assertActorCanAssignProfile(actorId, p);
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CONTADOR_LINK_DAYS * 86_400_000);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(openInvites).values({ profileId: p.id, tokenHash: hashToken(token), expiresAt, createdBy: actorId, createdAt: now }).returning({ id: openInvites.id });
    await tx.insert(auditLog).values({ userId: actorId, action: "gerou_link_contador", entity: "open_invite", entityId: row.id, data: { perfil: p.name, vence: expiresAt.toISOString() } });
    return { id: row.id, token, expiresAt };
  });
}

export type ContadorLinkRow = { id: string; createdAt: Date; expiresAt: Date; createdByName: string | null };

/** Os links do contador ainda valendo (sem uso, sem revogar e no prazo), do mais antigo ao mais novo. O link em si nunca volta: só o hash existe. */
export async function listContadorLinks(now: Date = new Date()): Promise<ContadorLinkRow[]> {
  const creator = alias(users, "creator");
  return db.select({ id: openInvites.id, createdAt: openInvites.createdAt, expiresAt: openInvites.expiresAt, createdByName: creator.name })
    .from(openInvites).innerJoin(profiles, eq(profiles.id, openInvites.profileId)).leftJoin(creator, eq(creator.id, openInvites.createdBy))
    .where(and(eq(profiles.key, "contador"), valid(now))).orderBy(asc(openInvites.createdAt));
}

export async function revokeContadorLink(id: string, actorId: string, now: Date = new Date()): Promise<void> {
  const linkId = z.string().uuid("Link inválido.").parse(id);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(openInvites).set({ revokedAt: now, revokedBy: actorId })
      .where(and(eq(openInvites.id, linkId), isNull(openInvites.usedAt), isNull(openInvites.revokedAt))).returning({ id: openInvites.id });
    if (!row) throw new UserFacingError("Esse link já foi usado, venceu ou foi cancelado.");
    await tx.insert(auditLog).values({ userId: actorId, action: "revogou_link_contador", entity: "open_invite", entityId: row.id });
  });
}

/** O link vale agora? Para a página pública /convite/[token]: devolve só o nome do perfil. */
export async function findContadorLink(token: string, now: Date = new Date()): Promise<{ id: string; profileName: string } | null> {
  if (!token) return null;
  const [r] = await db.select({ id: openInvites.id, profileName: profiles.name, key: profiles.key, permissions: profiles.permissions })
    .from(openInvites).innerJoin(profiles, eq(profiles.id, openInvites.profileId))
    .where(and(eq(openInvites.tokenHash, hashToken(token)), valid(now))).limit(1);
  return r && r.key === "contador" && !isPrivileged(r) ? { id: r.id, profileName: r.profileName } : null;
}

const formSchema = z.object({
  name: z.string().trim().min(2, "Escreva o seu nome.").max(80, "Nome muito longo (máx. 80)."),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200, "E-mail muito longo."),
  password: z.string().refine(isValidPassword, PASSWORD_RULE),
});
const isUniqueViolation = (e: unknown) => {
  const c = e as { code?: string; cause?: { code?: string } } | null;
  return c?.code === "23505" || c?.cause?.code === "23505";
};

/**
 * Quem abriu o link cria o próprio acesso. Confere o formulário e o link ANTES do argon2 (caro). Na transação, o link é marcado como usado
 * com a condição "ainda vale" (dois envios ao mesmo tempo: só um passa); e-mail repetido desfaz tudo e o link continua valendo.
 */
export async function acceptContadorLink(token: string, input: { name: string; email: string; password: string }, now: Date = new Date()): Promise<{ id: string }> {
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Confira os dados.");
  const v = parsed.data;
  if (!(await findContadorLink(token, now))) throw new UserFacingError(CONTADOR_LINK_GONE);
  const passwordHash = await hashPassword(v.password);
  return db.transaction(async (tx) => {
    const [inv] = await tx.update(openInvites).set({ usedAt: now })
      .where(and(eq(openInvites.tokenHash, hashToken(token)), valid(now))).returning({ id: openInvites.id, profileId: openInvites.profileId });
    if (!inv) throw new UserFacingError(CONTADOR_LINK_GONE);
    const [p] = await tx.select().from(profiles).where(eq(profiles.id, inv.profileId));
    if (!p || p.key !== "contador" || isPrivileged(p)) throw new UserFacingError(CONTADOR_LINK_GONE);
    // Mesma regra do convite e do "Criar acesso": e-mail único sem diferenciar maiúsculas (o índice users_email_uq segura a corrida).
    const [dup] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${v.email}`).limit(1);
    if (dup) throw new UserFacingError(CONTADOR_EMAIL_TAKEN);
    let u: { id: string };
    try {
      // Sem assinatura: o contador não manda mensagem para cliente.
      [u] = await tx.insert(users).values({ name: v.name, email: v.email, passwordHash, role: legacyRoleOf(p.permissions), profileId: p.id, active: true, signature: null })
        .returning({ id: users.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw new UserFacingError(CONTADOR_EMAIL_TAKEN);
      throw e;
    }
    await tx.update(openInvites).set({ usedBy: u.id }).where(eq(openInvites.id, inv.id));
    await tx.insert(auditLog).values({ userId: u.id, action: "usou_link_contador", entity: "user", entityId: u.id, data: { link: inv.id, perfil: p.name, email: v.email } });
    return u;
  });
}
