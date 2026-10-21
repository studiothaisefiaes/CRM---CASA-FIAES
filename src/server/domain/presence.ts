import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { deals, profiles, users } from "../db/schema";
import { can } from "@/lib/permissions";
import { findSessionUser } from "../auth/sessions-store";
import { chooseAssignee, type Availability } from "./routing";
import { freeCandidates, getDistributionSettings, PRESENCE_TIMEOUT_MIN } from "./distribution";
import { reassignWaitAlerts } from "./wait-alerts";
import { emit, logEvent } from "./events";

const dayInBahia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Bahia" });

/**
 * O CRM aberto bate a cada minuto (stream de tempo real). Marca o sinal e, para quem recebe leads, volta a "disponível":
 * - quem ficou ausente pelo sistema (sumiu 5 min ou saiu da conta);
 * - quem escolheu pausa ou ausente num dia anterior (o que a pessoa escolhe hoje vale o dia).
 */
export async function beat(userId: string, now: Date = new Date()): Promise<Availability | null> {
  const [u] = await db.select({ availability: users.availability, availabilityAt: users.availabilityAt, manual: users.availabilityManual, permissions: profiles.permissions })
    .from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  if (!u) return null;
  const otherDay = !u.availabilityAt || dayInBahia(u.availabilityAt) !== dayInBahia(now);
  // Pausa é sempre escolha da pessoa: só volta em outro dia. Ausente volta na hora se foi o sistema; se foi ela, em outro dia.
  const wake = can(u.permissions, "distribuicao.receber") && (u.availability === "pausa" ? otherDay : u.availability === "ausente" && (otherDay || !u.manual));
  await db.update(users).set({ lastSeenAt: now, ...(wake ? { availability: "disponivel", availabilityAt: now, availabilityManual: false } : {}) }).where(eq(users.id, userId));
  if (wake) await emit("equipe_atualizada", {});
  return (wake ? "disponivel" : u.availability) as Availability;
}

/** A batida da aba aberta confere a sessão a cada vez: depois de "Sair" (sessão apagada), a aba que ficou aberta para de ligar a pessoa. */
export async function beatForToken(token: string | undefined, now: Date = new Date()): Promise<boolean> {
  const user = await findSessionUser(token, now);
  if (!user) return false;
  await beat(user.id, now);
  return true;
}

/**
 * Trava, em ordem de id, todas as pessoas que recebem leads (a mesma ordem do `freeCandidates`): mudar o próprio estado e
 * redistribuir os leads não disputa travas em ordem trocada com uma mensagem chegando ao mesmo tempo (sem impasse).
 */
async function lockReceivers(tx: Tx, alsoId: string) {
  await tx.execute(sql`select u.id from users u left join profiles p on p.id = u.profile_id
    where u.id = ${alsoId} or (u.active and p.permissions @> array['distribuicao.receber']::text[]) order by u.id for update of u`);
}

/**
 * Pausa/ausência: os leads dela que ainda não tiveram nenhuma resposta voltam para a distribuição (outra pessoa livre,
 * ou sem dona, e aí o alerta de atraso vai para a gestão). Os que já estão em conversa continuam com ela. Só com a distribuição ligada.
 */
export async function returnUnanswered(tx: Tx, userId: string, motivo: "pausa" | "ausente", now: Date): Promise<number> {
  const cfg = await getDistributionSettings(tx);
  if (!cfg.enabled) return 0;
  const mine = await tx.select({ id: deals.id }).from(deals)
    .where(and(eq(deals.ownerId, userId), isNull(deals.closedAt), isNull(deals.archivedAt), isNull(deals.lastOutboundAt))).for("update");
  for (const d of mine) {
    const to = chooseAssignee(await freeCandidates(tx, now, cfg.limit), { excludeIds: [userId] });
    await tx.update(deals).set({ ownerId: to }).where(eq(deals.id, d.id));
    if (to) await tx.update(users).set({ lastAssignedAt: now }).where(eq(users.id, to));
    await reassignWaitAlerts(tx, d.id, to);
    await logEvent(tx, d.id, "devolvido_a_fila", { de: userId, para: to, motivo });
  }
  return mine.length;
}

/** A própria pessoa muda o estado (menu do nome: `manual`, vale o dia) ou o sistema a marca ausente ao sair da conta. */
export async function setAvailability(userId: string, a: Availability, now: Date = new Date(), opts: { manual?: boolean } = {}): Promise<{ returned: number }> {
  const manual = a === "disponivel" ? false : opts.manual ?? true;
  const returned = await db.transaction(async (tx) => {
    await lockReceivers(tx, userId);
    await tx.update(users).set({ availability: a, availabilityAt: now, availabilityManual: manual }).where(eq(users.id, userId));
    return a === "disponivel" ? 0 : returnUnanswered(tx, userId, a, now);
  });
  await emit("equipe_atualizada", {});
  if (returned) await emit("lead_atualizado", {});
  return { returned };
}

/**
 * Worker, a cada minuto: quem estava disponível e fechou o CRM ou perdeu a conexão há mais de 5 min vira ausente (pelo sistema)
 * e devolve os leads sem resposta. Pausa não muda: foi escolha da pessoa e os leads dela já voltaram ao pausar.
 */
export async function sweepPresence(now: Date = new Date()): Promise<{ away: number; returned: number }> {
  const since = new Date(now.getTime() - PRESENCE_TIMEOUT_MIN * 60_000);
  const stale = or(isNull(users.lastSeenAt), lt(users.lastSeenAt, since));
  const gone = await db.select({ id: users.id }).from(users).where(and(eq(users.availability, "disponivel"), stale));
  let away = 0, returned = 0;
  for (const u of gone) {
    returned += await db.transaction(async (tx) => {
      await lockReceivers(tx, u.id);
      // Confere de novo já com a trava: uma batida no meio do caminho mantém a pessoa como está.
      const [hit] = await tx.update(users).set({ availability: "ausente", availabilityAt: now, availabilityManual: false })
        .where(and(eq(users.id, u.id), eq(users.availability, "disponivel"), stale)).returning({ id: users.id });
      if (!hit) return 0;
      away++;
      return returnUnanswered(tx, u.id, "ausente", now);
    });
  }
  if (away) await emit("equipe_atualizada", {});
  if (returned) await emit("lead_atualizado", {});
  return { away, returned };
}
