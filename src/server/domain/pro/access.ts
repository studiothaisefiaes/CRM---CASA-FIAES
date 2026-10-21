import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { auditLog, professionals, profiles, pushSubscriptions, sessions, users } from "../../db/schema";
import { hashToken, newToken } from "../../auth/tokens";
import { env } from "../../env";
import { UserFacingError } from "../errors";
import { firstName } from "@/lib/authorship";
import { titleCase } from "@/lib/pro-day";
import { assertActorCanTouchMember } from "../profiles";

/** M3 (17/10): link novo e tirar acesso mexem na conta da usuária: a da dona e a das gestoras, só a Gestão. */
async function assertCanTouchProUser(professionalId: string, actorId: string) {
  const [p] = await db.select({ userId: professionals.userId }).from(professionals).where(eq(professionals.id, professionalId));
  if (p?.userId) await assertActorCanTouchMember(actorId, p.userId);
}

export const PRO_INVITE_DAYS = 7;
export type ProAccess = { userId: string; email: string; active: boolean; invitePending: boolean; inviteExpiresAt: string | null; enteredAt: string | null; devices: number };
export type InviteResult = { url: string; text: string; expiresAt: string };

const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido.");
const inviteText = (name: string, url: string) =>
  `Oi, ${name}! Este é o link para você entrar na sua agenda da Casa Fiaes pelo celular: ${url} (vale 7 dias). Crie sua senha e depois siga o passo a passo para pôr na tela inicial.`;
const result = (name: string, token: string, expiresAt: Date): InviteResult => {
  const url = `${env().APP_URL}/convite/${token}`;
  return { url, text: inviteText(name, url), expiresAt: expiresAt.toISOString() };
};

async function proProfileId(tx: Tx): Promise<string> {
  const [p] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "profissional"));
  if (!p) throw new UserFacingError("O perfil Profissional ainda não existe. Rode o seed (npm run db:seed).");
  return p.id;
}

/**
 * "Acesso ao app" (só `equipe.gerir`): cria ou refaz a usuária com o perfil Profissional e um convite de 7 dias, e liga à profissional.
 * Nada é enviado: a tela só copia o link. E-mail de outra pessoa da equipe é recusado com o nome dela.
 */
export async function inviteProfessional(professionalId: string, rawEmail: string, actorId: string, now = new Date()): Promise<InviteResult> {
  const email = emailSchema.parse(rawEmail);
  await assertCanTouchProUser(professionalId, actorId);
  const token = newToken();
  const inviteExpiresAt = new Date(now.getTime() + PRO_INVITE_DAYS * 86_400_000);
  const name = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(professionals).where(eq(professionals.id, professionalId)).for("update");
    if (!p) throw new UserFacingError("Profissional não encontrada.");
    if (!p.active) throw new UserFacingError("Essa profissional está desativada. Reative antes de dar acesso.");
    const profileId = await proProfileId(tx);
    const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`).for("update");
    if (u && u.id !== p.userId) {
      const [other] = await tx.select({ id: professionals.id }).from(professionals).where(eq(professionals.userId, u.id));
      // Nunca reaproveita o e-mail de alguém da equipe, de outra profissional ou de quem já entrou com outro perfil.
      if (other || u.profileId !== profileId || u.passwordHash) throw new UserFacingError(`Esse e-mail já é de ${firstName(u.name) ?? "outra pessoa"}. Use outro.`);
    }
    if (p.userId && (!u || u.id !== p.userId)) throw new UserFacingError("Ela já tem acesso com outro e-mail. Tire o acesso antes de usar um e-mail novo.");
    let userId: string;
    if (u) {
      await tx.update(users).set({ profileId, role: "atendente", active: true, inviteTokenHash: hashToken(token), inviteExpiresAt }).where(eq(users.id, u.id));
      userId = u.id;
    } else {
      const [c] = await tx.insert(users).values({ name: p.fullName?.trim() || titleCase(p.name), email, role: "atendente", profileId, inviteTokenHash: hashToken(token), inviteExpiresAt })
        .returning({ id: users.id });
      userId = c.id;
    }
    await tx.update(professionals).set({ userId }).where(eq(professionals.id, professionalId));
    await tx.insert(auditLog).values({ userId: actorId, action: "convidou_profissional", entity: "professional", entityId: professionalId, data: { email, usuaria: userId } });
    return titleCase(p.name);
  });
  return result(name, token, inviteExpiresAt);
}

/** "Gerar novo link" (ela esqueceu a senha ou o convite venceu): token novo de 7 dias; o anterior deixa de valer. */
export async function regenerateProInvite(professionalId: string, actorId: string, now = new Date()): Promise<InviteResult> {
  await assertCanTouchProUser(professionalId, actorId);
  const token = newToken();
  const inviteExpiresAt = new Date(now.getTime() + PRO_INVITE_DAYS * 86_400_000);
  const name = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(professionals).where(eq(professionals.id, professionalId));
    if (!p?.userId) throw new UserFacingError("Ela ainda não tem acesso. Crie o acesso com o e-mail dela.");
    const [u] = await tx.select({ active: users.active }).from(users).where(eq(users.id, p.userId)).for("update");
    if (!u?.active) throw new UserFacingError("O acesso dela foi tirado. Use 'Dar acesso de novo'.");
    await tx.update(users).set({ inviteTokenHash: hashToken(token), inviteExpiresAt }).where(eq(users.id, p.userId));
    await tx.insert(auditLog).values({ userId: actorId, action: "gerou_novo_convite", entity: "professional", entityId: professionalId, data: { usuaria: p.userId } });
    return titleCase(p.name);
  });
  return result(name, token, inviteExpiresAt);
}

/** Tira o acesso: usuária inativa, sessões e aparelhos de aviso apagados (a sessão cai na hora), convite sem valor. A ligação fica, para o histórico. */
export async function revokeUserTx(tx: Tx, userId: string): Promise<void> {
  await tx.update(users).set({ active: false, inviteTokenHash: null, inviteExpiresAt: null }).where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export async function revokeProAccess(professionalId: string, actorId: string): Promise<void> {
  await assertCanTouchProUser(professionalId, actorId);
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ userId: professionals.userId }).from(professionals).where(eq(professionals.id, professionalId));
    if (!p?.userId) throw new UserFacingError("Ela não tem acesso ao app.");
    await revokeUserTx(tx, p.userId);
    await tx.insert(auditLog).values({ userId: actorId, action: "tirou_acesso_profissional", entity: "professional", entityId: professionalId, data: { usuaria: p.userId } });
  });
}

/** O que a gestão vê em "Acesso ao app": e-mail, se entrou ("Entrou em 16/10"), convite pendente e quantos aparelhos recebem aviso. */
export async function proAccessList(now = new Date()): Promise<Record<string, ProAccess>> {
  const r = await db.execute(sql`
    select p.id as "professionalId", u.id as "userId", u.email, u.active,
      (u.invite_token_hash is not null and u.invite_expires_at > ${now.toISOString()}::timestamptz) as "invitePending",
      u.invite_expires_at as "inviteExpiresAt",
      (select min(a.created_at) from audit_log a where a.action = 'aceitou_convite' and a.entity_id = u.id::text) as "enteredAt",
      (select count(*)::int from push_subscriptions s where s.user_id = u.id) as devices
    from professionals p join users u on u.id = p.user_id`);
  type Row = { professionalId: string; userId: string; email: string; active: boolean; invitePending: boolean; inviteExpiresAt: Date | string | null; enteredAt: Date | string | null; devices: number };
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return Object.fromEntries((r.rows as Row[]).map((x) => [x.professionalId, {
    userId: x.userId, email: x.email, active: x.active, invitePending: x.invitePending, inviteExpiresAt: iso(x.inviteExpiresAt), enteredAt: iso(x.enteredAt), devices: x.devices,
  }]));
}
