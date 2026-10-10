import { asc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, stages } from "../db/schema";
import { getBusinessHours } from "../domain/hours";
import { formatPhone } from "../domain/phone";
import { businessSecondsBetween } from "../../lib/business-hours";
import { boardUrgency, orderByUrgency, type BoardUrgency } from "../../lib/board-order";
import { boardConds } from "./board";
import { lateExists } from "./late-count";

/** Quantas pessoas cada estação mostra; o resto vira "+N". */
export const JOURNEY_PEOPLE_MAX = 12;

export type JourneyPerson = {
  dealId: string; name: string; contactId: string; hasAvatar: boolean;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null;
  urgency: BoardUrgency; slaMinutes: number | null;
  /** Para o rótulo da estação: o horário marcado (Agendado), quando fechou ou perdeu e o valor da venda (Fechado). */
  scheduledAt: string | null; closedAt: string | null; valueCents: number | null;
};
export type JourneyStation = {
  /** Chave da etapa (`etapa=` da Fila). Follow-up 1 a 4 formam uma estação só: "followup". */
  key: string; name: string; kind: string; color: string; count: number;
  /** Leads com alerta de espera aberto (a mesma regra do sino, da Fila e do Quadro). */
  late: number;
  people: JourneyPerson[]; /** Quantos passaram do limite e viram "+N". */ more: number;
};
export type Journey = { stations: JourneyStation[] };

/** A chave da estação de uma etapa: o Follow-up 1 a 4 vira "followup" (como a coluna do Quadro). */
const stationKey = sql<string>`case when ${stages.kind} = 'followup' then 'followup' else ${stages.key} end`;

/**
 * A Jornada da gestão: cada etapa é uma estação com a contagem, quantos estão atrasados e as pessoas que estão ali (até 12, as mais urgentes primeiro).
 * As contagens são SQL próprio (`count(*)`, sem o limite de 600 leads do Quadro) sobre as MESMAS condições do Quadro (`boardConds`, visão da gestão),
 * e as pessoas são as 12 primeiras de cada estação (`row_number()`), sem a última mensagem. Quem chama garante que é gestão (a rota confere a sessão).
 * Dentro da estação o SQL ordena atrasados, depois quem espera há mais tempo, depois os que não esperam (mais recentes); com os 12 em mãos, a ordem final
 * é refeita pela regra do Quadro (perto do prazo conta o expediente).
 */
export async function getJourney(now = new Date()): Promise<Journey> {
  const { conds } = boardConds({}, { id: "", role: "gestor" });
  const where = sql.join([sql`${stages.active}`, ...conds], sql` and `);
  const [stageRows, counts, ranked, hours] = await Promise.all([
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
    db.select({ key: stationKey.as("station"), count: sql<number>`count(*)::int`, late: sql<number>`(count(*) filter (where ${lateExists(deals.id)}))::int` })
      .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(where).groupBy(stationKey),
    (() => {
      const top = db.select({
        id: deals.id, stageId: deals.stageId, contactId: sql<string>`${contacts.id}`.as("contact_id"), name: contacts.name, phone: contacts.phoneE164, hasAvatar: sql<boolean>`(${contacts.avatarPath} is not null)`.as("has_avatar"),
        awaitingReplySince: deals.awaitingReplySince, scheduledAt: deals.scheduledAt, closedAt: deals.closedAt, valueCents: deals.valueCents, late: sql<boolean>`${lateExists(deals.id)}`.as("is_late"),
        rn: sql<number>`row_number() over (partition by ${stationKey} order by ${lateExists(deals.id)} desc, ${deals.awaitingReplySince} asc nulls last, ${deals.stageEnteredAt} desc, ${deals.id})`.as("rn"),
      }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).where(where).as("top");
      return db.select().from(top).where(lte(top.rn, JOURNEY_PEOPLE_MAX));
    })(),
    getBusinessHours(),
  ]);

  const byStation = new Map(counts.map((c) => [c.key, c]));
  const stageById = new Map(stageRows.map((s) => [s.id, s]));
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const people = new Map<string, (JourneyPerson & { id: string; stageEnteredAt: string; waitSeconds: number; lastMessageAt: string | null })[]>();
  for (const r of ranked) {
    const st = stageById.get(r.stageId);
    if (!st) continue;
    const key = st.kind === "followup" ? "followup" : st.key;
    const open = st.kind !== "fechado" && st.kind !== "perdido";
    const since = iso(r.awaitingReplySince);
    const waitSeconds = open && since ? businessSecondsBetween(new Date(since).getTime(), now.getTime(), hours) : 0;
    const list = people.get(key) ?? [];
    list.push({
      id: r.id, dealId: r.id, name: r.name?.trim() || formatPhone(r.phone), contactId: r.contactId, hasAvatar: r.hasAvatar, awaitingSince: since,
      urgency: open ? boardUrgency({ late: r.late, awaiting: !!since, waitSeconds, slaMinutes: st.slaMinutes }) : "idle", slaMinutes: st.slaMinutes,
      scheduledAt: iso(r.scheduledAt), closedAt: iso(r.closedAt), valueCents: r.valueCents,
      stageEnteredAt: new Date(0).toISOString(), waitSeconds, lastMessageAt: null,
    });
    people.set(key, list);
  }

  const stations: JourneyStation[] = [];
  for (const s of stageRows) {
    const key = s.kind === "followup" ? "followup" : s.key;
    if (stations.some((x) => x.key === key)) continue;
    const c = byStation.get(key);
    const count = c?.count ?? 0;
    const shown = orderByUrgency(people.get(key) ?? []).slice(0, JOURNEY_PEOPLE_MAX).map(({ id: _id, stageEnteredAt: _e, waitSeconds: _w, lastMessageAt: _l, ...p }) => p);
    stations.push({ key, name: s.kind === "followup" ? "Follow-up" : s.name, kind: s.kind, color: s.color, count, late: c?.late ?? 0, people: shown, more: Math.max(0, count - shown.length) });
  }
  return { stations };
}
