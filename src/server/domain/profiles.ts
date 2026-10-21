import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, profiles, sessions, users } from "../db/schema";
import { GESTAO_REQUIRED, PERMS, PERM_LABEL, isPerm, legacyRoleOf, type Perm } from "@/lib/permissions";
import { createInvite } from "../auth/users";
import { hashPassword, verifyPassword } from "../auth/password";
import { allow, resetLimit } from "../auth/rate-limit";
import { UserFacingError } from "./errors";
import { defaultSignature, isValidSignature, normalizeSignature, signatureKey } from "@/lib/signature";

export type ProfileRow = { id: string; key: string | null; name: string; permissions: Perm[]; isSystem: boolean; members: number };

const audit = (tx: Tx | typeof db, userId: string, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}) =>
  tx.insert(auditLog).values({ userId, action, entity, entityId, data });

/** Perfis em ordem: os padrão primeiro, depois por nome; com quantas pessoas usam cada um (inclusive desativadas e convites pendentes: é o que trava o Apagar). */
export async function listProfiles(): Promise<ProfileRow[]> {
  const rows = await db.select({
    id: profiles.id, key: profiles.key, name: profiles.name, permissions: profiles.permissions, isSystem: profiles.isSystem,
    members: sql<number>`(select count(*)::int from users u where u.profile_id = "profiles"."id")`,
  }).from(profiles).orderBy(sql`${profiles.isSystem} desc`, asc(profiles.name));
  return rows.map((r) => ({ ...r, permissions: r.permissions.filter(isPerm) }));
}

/**
 * Depois de qualquer mudança (dentro da transação): quem fez a mudança (que gere a equipe, pela permissão da ação)
 * continua ativo e gerindo. Isso já garante que sobra pelo menos uma pessoa assim. Lança, e a transação desfaz tudo.
 */
async function assertTeamStillManaged(tx: Tx, actorId: string) {
  const rows = (await tx.execute(sql`
    select u.id from users u join profiles p on p.id = u.profile_id
    where u.active and p.permissions @> array['equipe.gerir']::text[]`)).rows as { id: string }[];
  if (!rows.some((r) => r.id === actorId)) throw new UserFacingError("Você não pode tirar o próprio acesso de gerir a equipe.");
}

/**
 * Revisão de segurança 17/10 (M3): "Gerir equipe e perfis" não vira dono do sistema.
 * - Quem não é da Gestão só concede permissão que tem (perfil novo ou editado, e pôr alguém num perfil).
 * - O perfil Gestão e quem é da Gestão ou gere a equipe (a dona e as gestoras) só a Gestão mexe.
 * A Gestão concede tudo: o que é opcional para ela (app da profissional, rodízio, mensagem em massa) ela liga no próprio perfil quando quiser.
 */
type Actor = { id: string; isGestao: boolean; perms: string[]; passwordHash: string | null };
async function actorOf(tx: Tx | typeof db, actorId: string): Promise<Actor> {
  const [a] = await tx.select({ key: profiles.key, perms: profiles.permissions, passwordHash: users.passwordHash }).from(users)
    .leftJoin(profiles, eq(profiles.id, users.profileId)).where(and(eq(users.id, actorId), eq(users.active, true)));
  if (!a) throw new UserFacingError("Sua sessão expirou. Entre de novo.");
  return { id: actorId, isGestao: a.key === "gestao", perms: a.perms ?? [], passwordHash: a.passwordHash };
}
export const GESTAO_ONLY = "Só quem é da Gestão pode mexer no perfil Gestão ou em quem gere a equipe.";
function assertCanGrant(actor: Actor, granted: readonly string[]) {
  if (actor.isGestao) return;
  const missing = granted.filter((p) => isPerm(p) && !actor.perms.includes(p));
  if (missing.length) throw new UserFacingError(`Você não pode dar uma permissão que você não tem: ${missing.map((p) => PERM_LABEL[p as Perm]).join(", ")}.`);
}
function assertGestao(actor: Actor) { if (!actor.isGestao) throw new UserFacingError(GESTAO_ONLY); }
/** A dona e as gestoras: perfil Gestão ou quem gere a equipe. */
const isPrivileged = (p: { key: string | null; permissions: string[] } | null | undefined) => !!p && (p.key === "gestao" || p.permissions.includes("equipe.gerir"));
async function assertCanTouchMember(tx: Tx | typeof db, actor: Actor, userId: string) {
  if (actor.isGestao) return;
  const [t] = await tx.select({ key: profiles.key, permissions: profiles.permissions }).from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  if (t && isPrivileged({ key: t.key, permissions: t.permissions ?? [] })) throw new UserFacingError(GESTAO_ONLY);
}
/** Para quem age sobre a usuária fora daqui (acesso ao app da profissional): mesma regra de trocar perfil, desativar e senha. */
export async function assertActorCanTouchMember(actorId: string, userId: string): Promise<void> {
  await assertCanTouchMember(db, await actorOf(db, actorId), userId);
}
/** Pôr alguém num perfil (trocar, convidar, criar acesso): só a Gestão põe na Gestão; e só concede o que tem. */
function assertCanAssignProfile(actor: Actor, p: { key: string | null; permissions: string[] }) {
  if (p.key === "gestao") assertGestao(actor);
  assertCanGrant(actor, p.permissions);
}

const nameSchema = z.string().trim().min(2, "O nome do perfil precisa de pelo menos 2 letras.").max(40, "Nome de perfil muito longo (máx. 40).");
const cleanPerms = (list: string[]): Perm[] => PERMS.filter((p) => list.includes(p));

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const [dup] = await tx.select({ id: profiles.id }).from(profiles)
    .where(and(sql`lower(${profiles.name}) = lower(${name})`, exceptId ? ne(profiles.id, exceptId) : undefined));
  if (dup) throw new UserFacingError("Já existe um perfil com esse nome.");
}

/** Cria (sem `id`) ou edita um perfil. O perfil Gestão sempre tem todas as permissões (menos o rodízio de leads, opcional). */
export async function saveProfile(input: { id?: string; name: string; permissions: string[] }, actorId: string): Promise<{ id: string }> {
  const name = nameSchema.parse(input.name);
  const perms = cleanPerms(input.permissions);
  return db.transaction(async (tx) => {
    const actor = await actorOf(tx, actorId);
    await assertNameFree(tx, name, input.id);
    if (!input.id) {
      assertCanGrant(actor, perms);
      const [row] = await tx.insert(profiles).values({ name, permissions: perms }).returning({ id: profiles.id });
      await audit(tx, actorId, "perfil_criado", "profile", row.id, { name, permissions: perms });
      return row;
    }
    const [cur] = await tx.select().from(profiles).where(eq(profiles.id, input.id)).for("update");
    if (!cur) throw new UserFacingError("Esse perfil não existe mais.");
    // Perfil Gestão ou de quem gere a equipe: editar rebaixaria (ou promoveria) gestoras sem passar pela Gestão.
    if (isPrivileged(cur)) assertGestao(actor);
    assertCanGrant(actor, perms.filter((p) => !cur.permissions.includes(p)));
    if (cur.key === "gestao" && GESTAO_REQUIRED.some((p) => !perms.includes(p))) throw new UserFacingError("O perfil Gestão sempre tem acesso a tudo.");
    await tx.update(profiles).set({ name, permissions: perms }).where(eq(profiles.id, cur.id));
    await tx.update(users).set({ role: legacyRoleOf(perms) }).where(eq(users.profileId, cur.id));
    await assertTeamStillManaged(tx, actorId);
    await audit(tx, actorId, "perfil_editado", "profile", cur.id, { de: { name: cur.name, permissions: cur.permissions }, para: { name, permissions: perms } });
    return { id: cur.id };
  });
}

export async function duplicateProfile(id: string, actorId: string): Promise<{ id: string }> {
  const [src] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (!src) throw new UserFacingError("Esse perfil não existe mais.");
  let name = `${src.name} (cópia)`;
  for (let i = 2; (await db.select({ id: profiles.id }).from(profiles).where(sql`lower(${profiles.name}) = lower(${name})`)).length; i++) name = `${src.name} (cópia ${i})`;
  return saveProfile({ name, permissions: src.permissions }, actorId);
}

export async function deleteProfile(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(profiles).where(eq(profiles.id, id)).for("update");
    if (!cur) return;
    if (cur.isSystem) throw new UserFacingError("Perfis padrão não podem ser apagados.");
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from users where profile_id = ${id}`)).rows as { n: number }[];
    if (n > 0) throw new UserFacingError(`Mova as ${n} ${n === 1 ? "pessoa" : "pessoas"} deste perfil antes de apagar.`);
    await tx.delete(profiles).where(eq(profiles.id, id));
    await audit(tx, actorId, "perfil_apagado", "profile", id, { name: cur.name });
  });
}

/** Troca o perfil de uma pessoa (e a coluna antiga `role`, para uma volta de versão). */
export async function setMemberProfile(userId: string, profileId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(profiles).where(eq(profiles.id, profileId));
    if (!p) throw new UserFacingError("Esse perfil não existe mais.");
    const [u] = await tx.select({ profileId: users.profileId }).from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new UserFacingError("Essa pessoa não está mais na equipe.");
    const actor = await actorOf(tx, actorId);
    await assertCanTouchMember(tx, actor, userId);
    assertCanAssignProfile(actor, p);
    await tx.update(users).set({ profileId, role: legacyRoleOf(p.permissions) }).where(eq(users.id, userId));
    await assertTeamStillManaged(tx, actorId);
    await audit(tx, actorId, "perfil_trocado", "user", userId, { de: u.profileId, para: profileId });
  });
}

/** Ativa ou desativa uma pessoa. Desativar derruba as sessões dela na hora. */
export async function setMemberActive(userId: string, active: boolean, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await assertCanTouchMember(tx, await actorOf(tx, actorId), userId);
    await tx.update(users).set({ active }).where(eq(users.id, userId));
    if (!active) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await assertTeamStillManaged(tx, actorId);
    }
    await audit(tx, actorId, active ? "reativou" : "desativou", "user", userId);
  });
}

/** Assinatura de quem atende (Configurações › Equipe). Vazio tira a assinatura. Duas pessoas não podem ter a mesma (sem diferenciar acento). */
export async function setMemberSignature(userId: string, raw: string | null, actorId: string): Promise<{ signature: string | null }> {
  const signature = raw?.trim() ? normalizeSignature(raw) : null;
  if (signature && !isValidSignature(signature)) throw new UserFacingError("Use só letras e espaço, de 2 a 30, como SARA.");
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, signature: users.signature }).from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new UserFacingError("Essa pessoa não está mais na equipe.");
    // A assinatura é como as mensagens dela saem: a da dona e a das gestoras, só a Gestão troca (M3, 17/10).
    await assertCanTouchMember(tx, await actorOf(tx, actorId), userId);
    if (signature) {
      const others = await tx.select({ name: users.name, signature: users.signature }).from(users)
        .where(and(ne(users.id, userId), sql`${users.signature} is not null`));
      const dup = others.find((o) => signatureKey(o.signature!) === signatureKey(signature));
      if (dup) throw new UserFacingError(`A assinatura ${signature} já é de ${dup.name}.`);
    }
    await tx.update(users).set({ signature }).where(eq(users.id, userId));
    await audit(tx, actorId, "assinatura_alterada", "user", userId, { de: u.signature, para: signature });
    return { signature };
  });
}

/** A assinatura do 1º nome para quem entra na equipe, se ninguém já usa (repetida fica sem: a gestão escolhe em Configurações › Equipe). */
async function freeDefaultSignature(name: string): Promise<string | null> {
  const sig = defaultSignature(name);
  if (!sig) return null;
  const taken = await db.select({ signature: users.signature }).from(users).where(sql`${users.signature} is not null`);
  return taken.some((t) => signatureKey(t.signature!) === signatureKey(sig)) ? null : sig;
}

/** Convite com perfil: devolve o token para montar o link. */
export async function inviteWithProfile(input: { name: string; email: string; profileId: string }, actorId: string): Promise<string> {
  const v = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email("E-mail inválido"), profileId: z.string().uuid("Escolha um perfil") }).parse(input);
  const [p] = await db.select().from(profiles).where(eq(profiles.id, v.profileId));
  if (!p) throw new UserFacingError("Esse perfil não existe mais.");
  assertCanAssignProfile(await actorOf(db, actorId), p);
  const token = await createInvite({ name: v.name, email: v.email, role: legacyRoleOf(p.permissions), profileId: p.id, signature: await freeDefaultSignature(v.name) });
  await audit(db, actorId, "convidou", "user", null, { email: v.email, perfil: p.name });
  return token;
}

const passwordSchema = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(200);

/**
 * Criar acesso direto (sem convite): a gestão escolhe nome, e-mail, senha e perfil e passa para a pessoa, que já entra.
 * O e-mail é guardado em minúsculas; repetido (sem diferenciar maiúsculas) é recusado.
 */
export async function createMember(input: { name: string; email: string; password: string; profileId: string }, actorId: string): Promise<{ id: string; email: string }> {
  const v = z.object({
    name: z.string().trim().min(2, "Escreva o nome.").max(80), email: z.string().trim().toLowerCase().email("E-mail inválido."),
    password: passwordSchema, profileId: z.string().uuid("Escolha um perfil."),
  }).parse(input);
  const [p] = await db.select().from(profiles).where(eq(profiles.id, v.profileId));
  if (!p) throw new UserFacingError("Esse perfil não existe mais. Escolha outro perfil.");
  assertCanAssignProfile(await actorOf(db, actorId), p);
  const [dup] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${v.email}`);
  if (dup) throw new UserFacingError("Já existe alguém com esse e-mail na equipe.");
  const passwordHash = await hashPassword(v.password);
  const signature = await freeDefaultSignature(v.name);
  const [u] = await db.insert(users).values({ name: v.name, email: v.email, passwordHash, role: legacyRoleOf(p.permissions), profileId: p.id, active: true, signature }).returning({ id: users.id, email: users.email });
  await audit(db, actorId, "criou_acesso", "user", u.id, { email: v.email, perfil: p.name });
  return u;
}

/**
 * Trocar a senha de alguém (esqueceu, saiu da equipe): a antiga para de valer e as sessões abertas caem na hora.
 * M3 (17/10): pede a senha de quem troca (uma sessão roubada não toma contas) e só a Gestão troca a de quem é da Gestão ou gere a equipe.
 */
export async function resetMemberPassword(userId: string, password: string, actorId: string, actorPassword: string): Promise<void> {
  const pw = passwordSchema.parse(password);
  const actor = await actorOf(db, actorId);
  const key = `trocar-senha:${actorId}`;
  if (!allow(key, 5)) throw new UserFacingError("Muitas tentativas com a sua senha. Espere 10 minutos e tente de novo.");
  if (!actorPassword || !(await verifyPassword(actor.passwordHash, actorPassword))) throw new UserFacingError("Sua senha não confere. Digite a senha com que você entra no CRM.");
  resetLimit(key);
  await assertCanTouchMember(db, actor, userId);
  const passwordHash = await hashPassword(pw);
  await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).returning({ id: users.id });
    if (!u) throw new UserFacingError("Essa pessoa não está mais na equipe.");
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await audit(tx, actorId, "trocou_senha", "user", userId, {});
  });
}
