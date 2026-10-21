import { and, asc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, users } from "../db/schema";
import { reassignWaitAlerts } from "./wait-alerts";
import { isOpen } from "../../lib/business-hours";
import { alertText, clientLabel } from "../../lib/alert-copy";
import { getBusinessHours } from "./hours";
import { chooseAssignee } from "./routing";
import { freeCandidates, getDistributionSettings } from "./distribution";
import { waitKeyOf } from "../rules/wait-key";
import { emit, logEvent } from "./events";

/**
 * Passou do prazo com dona: a próxima pessoa livre recebe "A dona não respondeu. Pode assumir Fulana?" (alerta com Assumir). A dona só perde a
 * conversa se alguém assumir. Uma oferta aberta por espera; sem resposta em mais um prazo da etapa, passa para a seguinte
 * (nunca a dona, nunca quem já recebeu). A oferta é um alerta com wait_key "oferta:<espera>:<n>": responder a cliente a
 * resolve junto com os alertas da espera, e ela recebe push como os outros.
 */
export async function offerOverdue(now: Date = new Date()): Promise<{ offered: number }> {
  const cfg = await getDistributionSettings();
  if (!cfg.enabled) return { offered: 0 };
  if (!isOpen(now.getTime(), await getBusinessHours())) return { offered: 0 };
  const late = (await db.execute(sql`
    select d.id, d.owner_id as "ownerId", d.awaiting_reply_since as "since", coalesce(s.sla_minutes, 2) as sla,
      coalesce(nullif(trim(c.name), ''), c.phone_e164) as name, c.phone_e164 as phone
    from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    where d.closed_at is null and d.archived_at is null and d.owner_id is not null and d.awaiting_reply_since is not null and c.kind = 'cliente'
      and exists (select 1 from alerts a where a.deal_id = d.id and a.resolved_at is null and a.wait_key is not null
                  and a.wait_key not like 'task:%' and a.wait_key not like 'oferta:%')`)).rows as
    { id: string; ownerId: string; since: string; sla: number; name: string; phone: string }[];
  let offered = 0;
  for (const d of late) {
    const base = `oferta:${waitKeyOf(d.id, new Date(d.since))}`;
    const made = await db.transaction(async (tx) => {
      // Trava o lead antes das ofertas: a mesma ordem do "Assumir" (lead → alertas), sem impasse.
      const [cur] = await tx.select({ ownerId: deals.ownerId, since: deals.awaitingReplySince }).from(deals).where(eq(deals.id, d.id)).for("update");
      if (!cur?.ownerId || !cur.since || cur.since.toISOString() !== new Date(d.since).toISOString()) return false; // mudou desde a consulta
      const prev = await tx.select().from(alerts).where(and(eq(alerts.dealId, d.id), like(alerts.waitKey, `${base}:%`))).for("update");
      const open = prev.find((o) => !o.resolvedAt);
      // O prazo da próxima oferta conta da última oferta (aberta ou já fechada) ou da última troca de dona nesta espera:
      // quem acabou de assumir ganha um prazo inteiro para responder.
      const owners = (await tx.select({ at: dealEvents.createdAt, payload: dealEvents.payload }).from(dealEvents)
        .where(and(eq(dealEvents.dealId, d.id), inArray(dealEvents.type, ["assumiu", "responsavel_alterado", "distribuido", "devolvido_a_fila"]), gte(dealEvents.createdAt, cur.since))));
      // Só conta troca que deu dona a alguém ("ninguém livre" na chegada não é troca de dona).
      const handovers = owners.filter((e) => { const p = e.payload as { para?: unknown }; return !("para" in (p ?? {})) || p.para != null; });
      const marks = [...prev.map((o) => (o.resolvedAt ?? o.createdAt).getTime()), ...handovers.map((e) => e.at.getTime())];
      if (marks.length && now.getTime() - Math.max(...marks) < d.sla * 60_000) return false;
      // Nunca a dona atual, nem quem já recebeu oferta, nem quem já foi dona nesta espera (não respondeu).
      const pastOwners = owners.flatMap((e) => { const p = e.payload as { de?: unknown; campos?: { campo: string; de: unknown }[] }; return [p.de, ...(p.campos ?? []).filter((c) => c.campo === "ownerId").map((c) => c.de)]; })
        .filter((x): x is string => typeof x === "string");
      const exclude = [cur.ownerId, ...prev.map((o) => o.userId).filter((x): x is string => !!x), ...pastOwners];
      const to = chooseAssignee(await freeCandidates(tx, now, cfg.limit), { excludeIds: exclude });
      if (!to) return false; // ninguém livre: a oferta aberta (se houver) continua; a escalada da gestão segue o motor
      if (open) await tx.update(alerts).set({ resolvedAt: now }).where(eq(alerts.id, open.id));
      const who = clientLabel(d.name === d.phone ? null : d.name, d.phone);
      const key = `${base}:${prev.length + 1}`;
      const [row] = await tx.insert(alerts).values({
        dealId: d.id, userId: to, audience: "responsavel", type: "oferta", severity: "urgente", level: 1,
        message: alertText.offer(who), dedupeKey: key, waitKey: key, createdAt: now,
      }).onConflictDoNothing().returning({ id: alerts.id });
      if (!row) return false;
      await logEvent(tx, d.id, "oferecido", { para: to, alertId: row.id });
      return true;
    });
    if (made) { offered++; await emit("alerta", { dealId: d.id }); }
  }
  return { offered };
}

/** Quem tem uma oferta aberta deste lead (para marcar "assumiu pela oferta"). */
export async function openOfferFor(dealId: string, userId: string, tx: Pick<typeof db, "select"> = db): Promise<boolean> {
  const [o] = await tx.select({ id: alerts.id }).from(alerts)
    .where(and(eq(alerts.dealId, dealId), eq(alerts.userId, userId), like(alerts.waitKey, "oferta:%"), sql`${alerts.resolvedAt} is null`)).limit(1);
  return !!o;
}


/**
 * Conversas que ficaram sem dona (ninguém livre na chegada, devolvidas à fila) vão para quem ficar livre, a que espera há
 * mais tempo primeiro. Roda a cada minuto no worker, só com a distribuição ligada.
 */
export async function assignWaitingUnowned(now: Date = new Date()): Promise<{ assigned: number }> {
  const cfg = await getDistributionSettings();
  if (!cfg.enabled) return { assigned: 0 };
  const waiting = await db.select({ id: deals.id }).from(deals)
    .where(and(isNull(deals.ownerId), isNull(deals.closedAt), isNull(deals.archivedAt), sql`${deals.awaitingReplySince} is not null`))
    .orderBy(asc(deals.awaitingReplySince)).limit(50);
  let assigned = 0;
  for (const w of waiting) {
    const to = await db.transaction(async (tx) => {
      const [cur] = await tx.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, w.id)).for("update");
      if (!cur || cur.ownerId) return null;
      const pick = chooseAssignee(await freeCandidates(tx, now, cfg.limit));
      if (!pick) return null;
      await tx.update(deals).set({ ownerId: pick }).where(eq(deals.id, w.id));
      await tx.update(users).set({ lastAssignedAt: now }).where(eq(users.id, pick));
      await reassignWaitAlerts(tx, w.id, pick);
      await logEvent(tx, w.id, "distribuido", { para: pick, motivo: "fila" });
      return pick;
    });
    if (!to) break; // ninguém mais livre agora
    assigned++;
    await emit("lead_atualizado", { dealId: w.id });
  }
  return { assigned };
}
