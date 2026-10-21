import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, deals, settings, users } from "../db/schema";
import { chooseAssignee, type Candidate } from "./routing";

/** Distribuição automática (Configurações › Distribuição). Nasce desligada: vale a regra antiga (menos leads abertos). */
export type DistributionSettings = { enabled: boolean; limit: number };
export const DISTRIBUTION_DEFAULT: DistributionSettings = { enabled: false, limit: 3 };
export const PRESENCE_TIMEOUT_MIN = 5;
export const PRESENCE_BEAT_MS = 60_000;

const schema = z.object({
  enabled: z.boolean(),
  limit: z.number().int().min(1, "O limite é de 1 a 20 conversas.").max(20, "O limite é de 1 a 20 conversas."),
});

export async function getDistributionSettings(tx: Tx | typeof db = db): Promise<DistributionSettings> {
  const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "distribuicao"));
  const v = schema.safeParse(row?.value);
  return v.success ? v.data : DISTRIBUTION_DEFAULT; // valor estranho no banco: padrão seguro (desligada)
}

export async function saveDistributionSettings(input: unknown, userId: string): Promise<DistributionSettings> {
  const v = schema.parse(input);
  const before = await getDistributionSettings();
  await db.insert(settings).values({ key: "distribuicao", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: "distribuicao", data: v });
  return v;
}

/**
 * Quem está livre agora: ativa, com senha, perfil com "Receber leads da distribuição", disponível, com sinal nos últimos
 * PRESENCE_TIMEOUT_MIN minutos e com menos conversas esperando resposta que o limite. Trava as linhas dessas pessoas
 * (FOR UPDATE, em ordem de id para não dar impasse): duas conversas chegando juntas não passam do limite de ninguém,
 * porque a segunda espera a primeira gravar e conta a carga já com ela.
 */
export async function freeCandidates(tx: Tx, now: Date, limit: number): Promise<Candidate[]> {
  const since = new Date(now.getTime() - PRESENCE_TIMEOUT_MIN * 60_000);
  const locked = (await tx.execute(sql`
    select u.id from users u join profiles p on p.id = u.profile_id
    where u.active and u.password_hash is not null and u.availability = 'disponivel' and u.last_seen_at > ${since.toISOString()}::timestamptz
      and p.permissions @> array['distribuicao.receber']::text[]
    order by u.id for update of u`)).rows as { id: string }[];
  if (!locked.length) return [];
  const rows = (await tx.execute(sql`
    select u.id, u.priority_level as priority, u.last_assigned_at as "lastAssignedAt",
      (select count(*)::int from deals d where d.owner_id = u.id and d.closed_at is null and d.archived_at is null and d.awaiting_reply_since is not null) as load
    from users u where u.id in (${sql.join(locked.map((r) => sql`${r.id}::uuid`), sql`, `)})`)).rows as { id: string; priority: number; lastAssignedAt: string | null; load: number }[];
  return rows.filter((r) => r.load < limit).map((r) => ({ id: r.id, priority: r.priority, load: r.load, lastAssignedAt: r.lastAssignedAt ? new Date(r.lastAssignedAt) : null }));
}

export type RouteResult = { handled: false } | { handled: true; ownerId: string | null; motivo: "retorno" | "prioridade" | "ninguem_livre" };

/** Distribuição ligada: escolhe quem recebe a conversa nova do contato (a dona do último lead fechado tem preferência). Desligada: `handled: false`. */
export async function routeNewLead(tx: Tx, contactId: string, now: Date = new Date()): Promise<RouteResult> {
  const cfg = await getDistributionSettings(tx);
  if (!cfg.enabled) return { handled: false };
  const cands = await freeCandidates(tx, now, cfg.limit);
  const [prev] = await tx.select({ ownerId: deals.ownerId }).from(deals)
    .where(and(eq(deals.contactId, contactId), isNotNull(deals.closedAt), isNotNull(deals.ownerId))).orderBy(desc(deals.closedAt)).limit(1);
  const id = chooseAssignee(cands, { preferId: prev?.ownerId ?? null });
  if (!id) return { handled: true, ownerId: null, motivo: "ninguem_livre" };
  await tx.update(users).set({ lastAssignedAt: now }).where(eq(users.id, id));
  return { handled: true, ownerId: id, motivo: prev?.ownerId === id ? "retorno" : "prioridade" };
}

/** Nível de prioridade de cada pessoa (1 recebe primeiro). */
export async function setPriorityLevel(userId: string, level: number, actorId: string): Promise<void> {
  const v = z.number().int().min(1, "O nível vai de 1 a 3.").max(3, "O nível vai de 1 a 3.").parse(level);
  await db.update(users).set({ priorityLevel: v }).where(eq(users.id, userId));
  await db.insert(auditLog).values({ userId: actorId, action: "editou", entity: "user", entityId: userId, data: { nivel: v } });
}

/** Quem entra na distribuição (perfil com "Receber leads"), com o estado ao vivo, o nível e quantas conversas esperam resposta. */
export async function distributionTeam(now: Date = new Date()) {
  const since = new Date(now.getTime() - PRESENCE_TIMEOUT_MIN * 60_000);
  const rows = (await db.execute(sql`
    select u.id, u.name, u.availability, u.priority_level as "priorityLevel", u.last_seen_at as "lastSeenAt",
      (select count(*)::int from deals d where d.owner_id = u.id and d.closed_at is null and d.archived_at is null and d.awaiting_reply_since is not null) as waiting
    from users u join profiles p on p.id = u.profile_id
    where u.active and u.password_hash is not null and p.permissions @> array['distribuicao.receber']::text[]
    order by u.priority_level, u.name`)).rows as { id: string; name: string; availability: string; priorityLevel: number; lastSeenAt: string | null; waiting: number }[];
  return rows.map((r) => ({ ...r, online: !!r.lastSeenAt && new Date(r.lastSeenAt) > since }));
}
