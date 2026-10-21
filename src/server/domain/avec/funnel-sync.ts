import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, contacts, deals, messages, stages, type Appointment, type Deal } from "../../db/schema";
import { findOpenDeal, moveToKindTx, stageByKind } from "../deals";
import { emit, logEvent } from "../events";
import { nextDayMorning, replaceOpenTaskTx } from "../tasks";
import { activeOwnerTx } from "../attempts";
import { enterAttendedTx, enterMissedTx } from "../funnel";
import { setAttendanceTx } from "../updates";
import { clientFirstName } from "../../../lib/attempts";
import { inHouseVisits, NA_CASA_LOOKUP_STATUSES } from "../../../lib/na-casa";
import { holderIdOf, numberContactIds } from "../people-on-number";

/**
 * A agenda (Avec ou marcada na Agenda do CRM) move o funil da cliente (Lote 1C). Decisão 4 do dono: só para quem conversou nos
 * últimos 30 dias; quem não conversou aparece só na Agenda e na ficha. Nunca envia mensagem.
 * - horário futuro (até 180 dias) → Agendado, com a data do mais próximo (sem conversa aberta: cartão novo em Agendado);
 * - compareceu no horário do lead → Atendida; faltou ou cancelou o horário do lead → Aguardando cliente com Remarcar;
 * - Na Casa (pedido do dono, 15/10): a visita de hoje em andamento (Chegou/Em atendimento, ou um serviço finalizado e outro da mesma
 *   visita ainda por fazer) → Na Casa; sai pelas mesmas regras acima quando o último horário termina, é cancelado ou faltou.
 */
export const FUTURE_MAX_DAYS = 180;
export const RECENT_CONVERSATION_DAYS = 30;
const DAY = 86_400_000;
const SAME_VISIT_MS = 12 * 3_600_000;
const OUTCOME_DAYS = 30;

export type FunnelSyncResult = { agendados: number; datasAtualizadas: number; naCasa: number; atendidas: number; aguardando: number; cartoesNovos: number; erros: string[] };
type Counter = Exclude<keyof FunnelSyncResult, "erros">;
export const emptyFunnelSync = (): FunnelSyncResult => ({ agendados: 0, datasAtualizadas: 0, naCasa: 0, atendidas: 0, aguardando: 0, cartoesNovos: 0, erros: [] });

/**
 * O horário vira a data do lead (profissional e serviço só preenchem o que está vazio), com a conferência de comparecimento, e o lead vai
 * para Agendado (ou, com a cliente no salão, para Na Casa).
 */
export async function applyAppointmentTx(tx: Tx, deal: Deal, appt: Appointment, now: Date, reason: string, kind: "agendado" | "na_casa" = "agendado") {
  const changed = deal.scheduledAt?.getTime() !== appt.startsAt.getTime();
  await tx.update(deals).set({
    scheduledAt: appt.startsAt, professionalId: deal.professionalId ?? appt.professionalId, serviceId: deal.serviceId ?? appt.serviceId,
    ...(changed ? { attendance: null, attendanceAt: null } : {}), // horário novo: o Compareceu/Faltou do anterior não vale
  }).where(eq(deals.id, deal.id));
  await tx.update(appointments).set({ dealId: deal.id }).where(and(eq(appointments.id, appt.id), isNull(appointments.dealId)));
  if (changed) {
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
    await replaceOpenTaskTx(tx, deal.id, deal.contactId, "comparecimento",
      { title: `Conferir se ${clientFirstName(c?.name)} veio`, dueAt: nextDayMorning(appt.startsAt), assigneeId: await activeOwnerTx(tx, deal.ownerId) }, null);
    await logEvent(tx, deal.id, "campo_alterado", { campos: [{ campo: "scheduledAt", de: deal.scheduledAt?.toISOString() ?? null, para: appt.startsAt.toISOString() }], origem: "avec" });
  }
  return moveToKindTx(tx, deal.id, kind, null, reason, now);
}

/**
 * Na Casa (pedido do dono, 15/10): a visita de HOJE em andamento (regra em `lib/na-casa`). Gêmeo do Avec não conta.
 * Devolve o 1º horário da visita (a data que o lead guarda) ou null.
 */
export async function inHouseAppointmentTx(tx: Tx, contactId: string | string[], now: Date): Promise<Appointment | null> {
  const rows = await tx.select().from(appointments)
    .where(and(Array.isArray(contactId) ? inArray(appointments.contactId, contactId) : eq(appointments.contactId, contactId), isNull(appointments.avecTwinOf), inArray(appointments.status, NA_CASA_LOOKUP_STATUSES),
      gte(appointments.startsAt, new Date(now.getTime() - SAME_VISIT_MS)), lte(appointments.startsAt, new Date(now.getTime() + SAME_VISIT_MS))));
  return inHouseVisits(rows, now)[0]?.[0] ?? null;
}

/** A etapa Na Casa só vale se existir ativa (a gestão pode desativar): sem ela, a regra de antes (fica em Agendado). */
async function hasNaCasaStageTx(tx: Tx): Promise<boolean> {
  const [s] = await tx.select({ id: stages.id }).from(stages).where(and(eq(stages.kind, "na_casa"), eq(stages.active, true))).limit(1);
  return !!s;
}

/** Cartão novo em Agendado (contato sem conversa aberta). A dona é a da última conversa dela. */
export async function createScheduledDealTx(tx: Tx, contactId: string, appt: Appointment, now: Date): Promise<string> {
  const [last] = await tx.select({ ownerId: deals.ownerId, channelId: deals.channelId }).from(deals).where(eq(deals.contactId, contactId)).orderBy(desc(deals.createdAt)).limit(1);
  const stage = await stageByKind("agendado", tx);
  const [d] = await tx.insert(deals).values({ contactId, stageId: stage.id, ownerId: last?.ownerId ?? null, channelId: last?.channelId ?? null, origin: "Avec", stageEnteredAt: now, createdAt: now }).returning();
  await logEvent(tx, d.id, "lead_criado", { origin: "Avec", initialStage: stage.key, historico: false, avec: true });
  await applyAppointmentTx(tx, d, appt, now, "avec_horario");
  return d.id;
}

export async function syncContactFunnelTx(tx: Tx, contactId: string, now: Date): Promise<{ result: Counter | null; dealId: string | null }> {
  // Várias pessoas no mesmo número (0051): a conversa é a do titular e conta os horários de todas as pessoas do número.
  contactId = await holderIdOf(contactId, tx);
  const ids = await numberContactIds(contactId, tx);
  // Na Casa vem antes de tudo: com a visita em andamento, a conversa fica lá até o último horário terminar.
  const here = (await hasNaCasaStageTx(tx)) ? await inHouseAppointmentTx(tx, ids, now) : null;
  if (here) {
    const open = await findOpenDeal(contactId, tx);
    if (!open) {
      const dealId = await createScheduledDealTx(tx, contactId, here, now);
      await moveToKindTx(tx, dealId, "na_casa", null, "na_casa", now);
      return { result: "cartoesNovos", dealId };
    }
    const [cur] = await tx.select({ kind: stages.kind }).from(stages).where(eq(stages.id, open.stageId));
    if (cur.kind === "na_casa") return { result: null, dealId: null };
    await applyAppointmentTx(tx, open, here, now, "na_casa", "na_casa");
    return { result: "naCasa", dealId: open.id };
  }
  // 6B: gêmeo do Avec nunca conta; Chegou e Em atendimento ainda vão acontecer (a visita está em andamento desde o começo do dia).
  const [future] = await tx.select().from(appointments)
    .where(and(inArray(appointments.contactId, ids), isNull(appointments.avecTwinOf),
      or(
        and(inArray(appointments.status, ["agendado", "confirmado"]), gt(appointments.startsAt, now)),
        and(inArray(appointments.status, ["chegou", "em_atendimento"]), gte(appointments.startsAt, new Date(now.getTime() - SAME_VISIT_MS))),
      ),
      lte(appointments.startsAt, new Date(now.getTime() + FUTURE_MAX_DAYS * DAY))))
    .orderBy(asc(appointments.startsAt)).limit(1);
  const deal = await findOpenDeal(contactId, tx);
  if (future) {
    if (!deal) return { result: "cartoesNovos", dealId: await createScheduledDealTx(tx, contactId, future, now) };
    const [st] = await tx.select({ kind: stages.kind }).from(stages).where(eq(stages.id, deal.stageId));
    if (st.kind === "agendado" && deal.scheduledAt?.getTime() === future.startsAt.getTime()) return { result: null, dealId: null };
    await applyAppointmentTx(tx, deal, future, now, "avec_horario");
    return { result: st.kind === "agendado" ? "datasAtualizadas" : "agendados", dealId: deal.id };
  }
  if (!deal) return { result: null, dealId: null };
  const [st] = await tx.select({ kind: stages.kind }).from(stages).where(eq(stages.id, deal.stageId));
  const scheduled = st.kind === "agendado" || st.kind === "na_casa";
  const sameVisit = (a: Appointment) => !scheduled
    ? a.startsAt.getTime() > deal.stageEnteredAt.getTime()
    : deal.scheduledAt ? Math.abs(a.startsAt.getTime() - deal.scheduledAt.getTime()) <= SAME_VISIT_MS : a.startsAt.getTime() >= deal.stageEnteredAt.getTime() - SAME_VISIT_MS;
  const since = new Date(now.getTime() - OUTCOME_DAYS * DAY);
  const visits = await tx.select().from(appointments).where(and(inArray(appointments.contactId, ids), eq(appointments.status, "compareceu"), isNull(appointments.avecTwinOf),
    gte(appointments.startsAt, since), lte(appointments.startsAt, new Date(now.getTime() + SAME_VISIT_MS)))).orderBy(desc(appointments.startsAt)); // finalizou antes da hora marcada também conta
  const visit = visits.find(sameVisit);
  if (visit && st.kind !== "atendido") {
    await setAttendanceTx(tx, deal.id, "compareceu", null);
    await tx.update(deals).set({ attendanceAt: visit.startsAt }).where(eq(deals.id, deal.id));
    await enterAttendedTx(tx, deal.id, null, "avec_compareceu", now, { visitAt: visit.startsAt });
    return { result: "atendidas", dealId: deal.id };
  }
  if (!scheduled) return { result: null, dealId: null };
  const misses = await tx.select().from(appointments).where(and(inArray(appointments.contactId, ids), inArray(appointments.status, ["faltou", "cancelado"]), isNull(appointments.avecTwinOf),
    gte(appointments.startsAt, since), lte(appointments.startsAt, new Date(now.getTime() + FUTURE_MAX_DAYS * DAY)))).orderBy(desc(appointments.startsAt));
  const miss = misses.find(sameVisit);
  if (!miss) return { result: null, dealId: null };
  if (miss.status === "faltou") await setAttendanceTx(tx, deal.id, "faltou", null);
  else await replaceOpenTaskTx(tx, deal.id, deal.contactId, "comparecimento", null, null); // cancelou: não há o que conferir
  await enterMissedTx(tx, deal.id, null, "avec_faltou", now);
  return { result: "aguardando", dealId: deal.id };
}

/** Roda a regra para quem conversou nos últimos 30 dias (ou só para `contactIds`). Uma transação por cliente; um erro não para as outras. */
export async function syncFunnelFromAgenda(opts: { now?: Date; contactIds?: string[] } = {}): Promise<FunnelSyncResult> {
  const now = opts.now ?? new Date();
  const out = emptyFunnelSync();
  if (opts.contactIds && !opts.contactIds.length) return out;
  const since = new Date(now.getTime() - RECENT_CONVERSATION_DAYS * DAY);
  const ids = (await db.selectDistinct({ id: messages.contactId }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(gte(messages.createdAt, since), isNull(messages.importedAt), eq(contacts.ignored, false), opts.contactIds ? inArray(messages.contactId, opts.contactIds) : undefined))).map((r) => r.id);
  for (const contactId of ids) {
    try {
      const r = await db.transaction((tx) => syncContactFunnelTx(tx, contactId, now));
      if (r.result) { out[r.result]++; if (r.dealId) await emit("etapa_alterada", { dealId: r.dealId }); }
    } catch (e) { out.erros.push(`${contactId}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
