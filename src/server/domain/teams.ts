import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, auditLog, contacts, deals, teamMembers, teams, users } from "../db/schema";
import { clientLabel } from "../../lib/alert-copy";
import { fillTexto } from "../../lib/funcoes";
import { UserFacingError } from "./errors";
import { emit, logEvent } from "./events";
import { PRESENCE_TIMEOUT_MIN } from "./distribution";
import { assertFuncaoLigada, funcaoTexto } from "./funcoes";
import { closeOffers, transferDealTx } from "./assign";
import { updateDealTx } from "./updates";

export type TeamRow = { id: string; name: string; active: boolean; members: { id: string; name: string }[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Os setores na ordem da Casa, com as pessoas de cada um. */
export async function listTeams(): Promise<TeamRow[]> {
  const [rows, members] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.position), asc(teams.createdAt)),
    db.select({ teamId: teamMembers.teamId, id: users.id, name: users.name }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).orderBy(asc(users.name)),
  ]);
  return rows.map((t) => ({ id: t.id, name: t.name, active: t.active, members: members.filter((m) => m.teamId === t.id).map((m) => ({ id: m.id, name: m.name })) }));
}

/** Cria ou edita um setor e troca as pessoas dele. O nome é único sem diferenciar acento nem maiúsculas. */
export async function saveTeam(input: { id?: string; name: string; active?: boolean; memberIds: string[] }, actorId: string): Promise<{ id: string }> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new UserFacingError("Escreva o nome do setor.");
  if (name.length > 60) throw new UserFacingError("O nome do setor tem no máximo 60 letras.");
  const memberIds = [...new Set(input.memberIds)];
  return db.transaction(async (tx) => {
    const all = await tx.select().from(teams);
    const dup = all.find((t) => t.id !== input.id && norm(t.name) === norm(name));
    if (dup) throw new UserFacingError(`Já existe o setor ${dup.name}.`);
    if (input.id && !all.some((t) => t.id === input.id)) throw new UserFacingError("Setor não encontrado.");
    if (memberIds.length) {
      const ok = await tx.select({ id: users.id }).from(users).where(inArray(users.id, memberIds));
      if (ok.length !== memberIds.length) throw new UserFacingError("Uma das pessoas escolhidas não está mais na equipe.");
    }
    let id = input.id;
    if (id) {
      await tx.update(teams).set({ name, ...(input.active === undefined ? {} : { active: input.active }) }).where(eq(teams.id, id));
    } else {
      const position = Math.max(0, ...all.map((t) => t.position)) + 1;
      [{ id }] = await tx.insert(teams).values({ name, position, active: input.active ?? true }).returning({ id: teams.id });
    }
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, id));
    if (memberIds.length) await tx.insert(teamMembers).values(memberIds.map((userId) => ({ teamId: id!, userId })));
    await tx.insert(auditLog).values({ userId: actorId, action: input.id ? "editou" : "criou", entity: "team", entityId: id, data: { name, active: input.active ?? true, memberIds } });
    return { id };
  });
}

/**
 * Quem do setor recebe agora: ativa, com senha, Disponível, com sinal nos últimos PRESENCE_TIMEOUT_MIN minutos e que abre as Conversas
 * (a mesma regra de presença da distribuição, mas SEM exigir "Receber leads": Thaise está no Método Fiaes® sem receber distribuição).
 * Menos conversas esperando resposta primeiro; empate: quem recebeu há mais tempo. Trava as linhas (FOR UPDATE, em ordem de id).
 */
export async function pickTeamMember(tx: Tx, teamId: string, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - PRESENCE_TIMEOUT_MIN * 60_000);
  const locked = (await tx.execute(sql`
    select u.id from team_members tm join users u on u.id = tm.user_id
    where tm.team_id = ${teamId}::uuid and u.active and u.password_hash is not null and u.availability = 'disponivel'
      and u.last_seen_at > ${since.toISOString()}::timestamptz
      and (u.profile_id is null or exists (select 1 from profiles p where p.id = u.profile_id and 'atendimento.ver' = any(p.permissions)))
    order by u.id for update of u`)).rows as { id: string }[];
  if (!locked.length) return null;
  const rows = (await tx.execute(sql`
    select u.id, u.last_assigned_at as "lastAssignedAt",
      (select count(*)::int from deals d where d.owner_id = u.id and d.closed_at is null and d.archived_at is null and d.awaiting_reply_since is not null) as load
    from users u where u.id in (${sql.join(locked.map((r) => sql`${r.id}::uuid`), sql`, `)})`)).rows as { id: string; lastAssignedAt: string | null; load: number }[];
  rows.sort((a, b) => a.load - b.load || (a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0) - (b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0));
  return rows[0].id;
}

/**
 * "Passar para setor": marca a conversa no setor e a entrega a quem do setor está livre. Ninguém livre: fica sem dona, no setor,
 * e a gestão é avisada no sino. `actorId` nulo = o sistema (menu e regras). Recusa se a função Setores estiver desligada.
 */
export async function passToTeam(dealId: string, teamId: string, actorId: string | null, now: Date = new Date()): Promise<{ ownerId: string | null }> {
  await assertFuncaoLigada("setores");
  const ownerId = await db.transaction((tx) => passToTeamTx(tx, dealId, teamId, actorId, now));
  await emit("lead_atualizado", { dealId });
  await emit("alerta", { dealId });
  return { ownerId };
}

/** O mesmo, dentro de uma transação (regras). Não confere a função Setores (quem chama confere) e não avisa as telas (quem chama, depois do commit). */
export async function passToTeamTx(tx: Tx, dealId: string, teamId: string, actorId: string | null, now: Date): Promise<string | null> {
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId));
  if (!team) throw new UserFacingError("Setor não encontrado.");
  if (!team.active) throw new UserFacingError("Esse setor está desativado.");
  const [deal] = await tx.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId)).for("update");
  if (!deal) throw new UserFacingError("Conversa não encontrada");
  const pick = await pickTeamMember(tx, teamId, now);
  await tx.update(deals).set({ teamId }).where(eq(deals.id, dealId));
  if (pick) {
    await tx.update(users).set({ lastAssignedAt: now }).where(eq(users.id, pick));
    await transferDealTx(tx, dealId, pick, actorId);
  } else {
    await updateDealTx(tx, dealId, { ownerId: null }, actorId); // evento, auditoria e avisos de espera como na troca normal
    await closeOffers(tx, dealId);
    const [c] = await tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, deal.contactId));
    const message = fillTexto(await funcaoTexto("setores", "sem_ninguem"), { nome: clientLabel(c?.name, c?.phone ?? ""), setor: team.name });
    await tx.insert(alerts).values({ dealId, userId: null, audience: "gestao", type: "setor_sem_ninguem", severity: "info", message, dedupeKey: `setor:${dealId}:${now.getTime()}` });
  }
  await logEvent(tx, dealId, "passado_para_setor", { setor: team.name, para: pick }, actorId);
  return pick;
}
