import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, dealEvents, deals, lists, stages, tasks, type Deal } from "../db/schema";
import { moveToKindTx } from "./deals";
import { emit, logEvent } from "./events";
import { cancelOpenTasksByOriginTx, completeTaskTx, nextDayMorning, POS_ATENDIMENTO_META, REMARCAR_META, remarcarDueAt, setNextActionTx } from "./tasks";
import { ATTEMPT_META, activeOwnerTx, rescheduleAttemptTx, startAttemptsTx, type AttemptStart } from "./attempts";
import { UserFacingError } from "./errors";
import { getBusinessHours } from "./hours";
import { attemptDaysOf, LAST_REPLY_DAYS, MAX_ATTEMPTS, RECONTACT_DAYS, attemptDueAt, attemptTitle, clientFirstName, type WaitingKind, clientFullName } from "../../lib/attempts";
import type { BusinessHours } from "../../lib/business-hours";

/**
 * O funil da Casa (Lote 1C): as passagens que a equipe faz com um toque e as que o sistema faz sozinho.
 * Nada aqui envia mensagem: as tentativas são próximas ações (combinados) que viram aviso no dia.
 */

type WaitInput = { resumeAt?: Date | null; title?: string | null; assigneeId?: string | null };

async function openDealState(tx: Tx, dealId: string) {
  const [d] = await tx.select({ kind: stages.kind, closedAt: deals.closedAt, archivedAt: deals.archivedAt, name: contacts.name, attempt: deals.followupAttempt })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(eq(deals.id, dealId)).for("update", { of: deals });
  if (!d) throw new UserFacingError("Conversa não encontrada");
  if (d.closedAt) throw new UserFacingError("Essa conversa já terminou (atendida ou perdida).");
  if (d.archivedAt) throw new UserFacingError("Essa conversa saiu da lista.");
  return d;
}

/** A conversa deixa de esperar a Casa: espera zerada e avisos resolvidos (como o "Retomar depois" fazia). */
async function clearWaitTx(tx: Tx, dealId: string, now: Date) {
  await tx.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, dealId));
  await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
}

/**
 * Esperar a cliente (nova organização, 16/10: "Aguardando cliente" deixou de ser etapa): a conversa fica (ou vai para) Em conversa e as
 * tentativas começam ali. Reinicia a contagem da etapa (`stageEnteredAt`), que é de onde as tentativas contam os dias. Quem já espera não muda.
 * Usado pelo Retomar, pela automação "a Casa falou por último", pelo Faltou e pelo Hora de voltar em que a Casa escreveu.
 */
export async function waitForClientTx(tx: Tx, dealId: string, userId: string | null, reason: string, at: Date, opts: AttemptStart = {}): Promise<Deal> {
  let deal = await moveToKindTx(tx, dealId, "atendimento", userId, reason, at);
  if (deal.followupAttempt > 0) return deal;
  [deal] = await tx.update(deals).set({ stageEnteredAt: at }).where(eq(deals.id, dealId)).returning();
  return startAttemptsTx(tx, deal, "atendimento", userId, at, opts);
}

/**
 * Retomar sem mensagem programada: a bola está com a cliente. Fica em Em conversa com a tentativa 1 na data escolhida ou, sem data, em D+1.
 * Já esperando (Em conversa com tentativas, ou Orçamento): só troca a data da tentativa atual.
 * Agendado/Na Casa/Atendida: a etapa não muda, fica só o lembrete (pede a data); Na Casa não tem tentativas.
 */
export async function markWaitingForClient(dealId: string, input: WaitInput, userId: string | null, now = new Date()): Promise<{ dueAt: Date }> {
  const dueAt = await db.transaction(async (tx) => {
    const d = await openDealState(tx, dealId);
    const title = input.title?.trim() || undefined;
    const assignee = input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {};
    let due: Date;
    if (d.kind === "agendado" || d.kind === "na_casa" || d.kind === "atendido") {
      if (!input.resumeAt) throw new UserFacingError("Essa cliente já tem horário. Escolha a data para retomar.");
      due = (await setNextActionTx(tx, dealId, { title: title ?? `Retomar contato com ${clientFirstName(d.name)}`, dueAt: input.resumeAt, ...assignee }, userId, now)).dueAt;
    } else if (d.kind === "proposta" || d.kind === "followup" || (d.kind === "atendimento" && d.attempt > 0)) {
      if (!input.resumeAt) throw new UserFacingError("Ela já está esperando a cliente. Escolha a data para retomar.");
      due = (await rescheduleAttemptTx(tx, dealId, { resumeAt: input.resumeAt, title, ...assignee }, userId, now)).dueAt;
    } else {
      const moved = await waitForClientTx(tx, dealId, userId, "aguardando_cliente", now, { resumeAt: input.resumeAt ?? null, taskTitle: title, ...assignee });
      due = moved.followupDueAt!;
    }
    await clearWaitTx(tx, dealId, now);
    await logEvent(tx, dealId, "aguardando_cliente", { retomarEm: due.toISOString(), automatico: !input.resumeAt, etapaAntes: d.kind }, userId);
    return due;
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
  return { dueAt };
}

/** "Mandar orçamento": Orçamento, com as tentativas no ritmo do orçamento (a 1ª em 2 dias). */
export async function markProposalSent(dealId: string, userId: string | null, now = new Date(), input: WaitInput = {}): Promise<{ dueAt: Date }> {
  const dueAt = await db.transaction(async (tx) => {
    const d = await openDealState(tx, dealId);
    if (d.kind === "agendado" || d.kind === "na_casa" || d.kind === "atendido") throw new UserFacingError("Essa cliente já tem horário marcado.");
    if (d.kind === "proposta") throw new UserFacingError("Já está em Orçamento.");
    const moved = await moveToKindTx(tx, dealId, "proposta", userId, "orcamento_enviado", now, {
      resumeAt: input.resumeAt ?? null, taskTitle: input.title?.trim() || undefined, ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    });
    await clearWaitTx(tx, dealId, now);
    await logEvent(tx, dealId, "orcamento_enviado", { retomarEm: moved.followupDueAt?.toISOString() ?? null, etapaAntes: d.kind }, userId);
    return moved.followupDueAt!;
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
  return { dueAt };
}

export const NO_REPLY_REASON = "Não respondeu mais";

/** Perdido "Não respondeu mais". Recontato em 30 dias só na 1ª vez deste lead (a automação "recontato" o devolve para Em conversa). */
async function loseNoReplyTx(tx: Tx, dealId: string, now: Date, hours: BusinessHours) {
  await tx.insert(lists).values({ kind: "lost_reason", label: NO_REPLY_REASON, position: 99 }).onConflictDoNothing();
  const [reason] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, NO_REPLY_REASON)));
  const before = await tx.select({ id: dealEvents.id }).from(dealEvents)
    .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "etapa_alterada"), sql`${dealEvents.payload}->>'motivo' = 'nao_respondeu'`)).limit(1);
  await tx.update(deals).set({ lostReasonId: reason.id, recontactAt: before.length ? null : attemptDueAt(now.getTime(), RECONTACT_DAYS, hours) }).where(eq(deals.id, dealId));
  await moveToKindTx(tx, dealId, "perdido", null, "nao_respondeu", now);
}

type AttemptRow = {
  id: string; ownerId: string | null; name: string | null; kind: WaitingKind; enteredAt: Date; attempt: number; dueAt: Date | null;
  taskId: string | null; taskDone: boolean; openTaskId: string | null; openTaskDue: Date | null; casaEscreveu: boolean;
  attemptDays: number[] | null;
};

/**
 * Worker, a cada minuto. Em Orçamento e em Em conversa esperando a cliente (e na antiga Aguardando cliente, se sobrou alguma):
 * - a tentativa atual conta como feita quando a Casa mandou mensagem no dia dela (ou depois) ou alguém concluiu o combinado dela;
 *   aí nasce a próxima (D+3, D+7; nunca no mesmo dia) ou, depois da 3ª, começam os 2 dias para a última resposta;
 * - a equipe trocou a próxima ação: a nova vira a tentativa;
 * - 2 dias depois da 3ª tentativa sem resposta: Perdido "Não respondeu mais".
 * Ninguém tentou: nada acontece (o combinado fica vencido em Combinados). Nunca envia mensagem.
 */
export async function sweepAttempts(now = new Date()): Promise<{ advanced: number; adopted: number; lost: number; errors: string[] }> {
  const rows = (await db.execute(sql`
    select d.id, d.owner_id as "ownerId", c.name, s.kind::text as kind, s.attempt_days as "attemptDays", d.stage_entered_at as "enteredAt", d.followup_attempt as attempt,
      d.followup_due_at as "dueAt", d.followup_task_id as "taskId",
      exists (select 1 from deal_events e where e.deal_id = d.id and e.type = 'tarefa' and e.payload->>'acao' = 'concluida'
        and e.payload->>'tarefa' = d.followup_task_id::text) as "taskDone",
      ot.id as "openTaskId", ot.due_at as "openTaskDue",
      (d.followup_due_at is not null and exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'out'
        and m.status not in ('failed', 'pending') and m.created_at > d.stage_entered_at
        and m.created_at >= ((d.followup_due_at at time zone 'America/Bahia')::date)::timestamp at time zone 'America/Bahia')) as "casaEscreveu"
    from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
      left join lateral (select t.id, t.due_at from tasks t where t.deal_id = d.id and t.kind = 'proxima_acao' and t.done_at is null
        order by t.due_at asc limit 1) ot on true
    where d.closed_at is null and d.archived_at is null and c.kind not in ('fornecedor', 'spam') and s.kind in ('followup', 'proposta', 'atendimento') and d.followup_attempt >= 1`)).rows as AttemptRow[];
  const out = { advanced: 0, adopted: 0, lost: 0, errors: [] as string[] };
  if (!rows.length) return out;
  const hours = await getBusinessHours();
  for (const r of rows) {
    try {
      const did = await db.transaction(async (tx): Promise<"advanced" | "adopted" | "lost" | null> => {
        const [cur] = await tx.select({ attempt: deals.followupAttempt, taskId: deals.followupTaskId, closedAt: deals.closedAt }).from(deals).where(eq(deals.id, r.id)).for("update");
        if (!cur || cur.closedAt || cur.attempt !== r.attempt || cur.taskId !== r.taskId) return null; // mudou nesse meio-tempo
        if (r.attempt > MAX_ATTEMPTS) {
          if (!r.dueAt || new Date(r.dueAt).getTime() > now.getTime()) return null;
          await loseNoReplyTx(tx, r.id, now, hours);
          return "lost";
        }
        if (!r.taskDone && !r.casaEscreveu) {
          if (r.openTaskId && r.openTaskId !== r.taskId) {
            await tx.update(deals).set({ followupTaskId: r.openTaskId, followupDueAt: new Date(r.openTaskDue!) }).where(eq(deals.id, r.id));
            return "adopted";
          }
          return null;
        }
        if (r.taskId && !r.taskDone) await completeTaskTx(tx, r.taskId, null, "concluida", now);
        await logEvent(tx, r.id, "tentativa", { feita: r.attempt, por: r.taskDone ? "tarefa" : "mensagem" });
        if (r.attempt < MAX_ATTEMPTS) {
          const next = r.attempt + 1;
          const planned = attemptDueAt(new Date(r.enteredAt).getTime(), attemptDaysOf(r.kind, r.attemptDays)[next - 1], hours);
          const earliest = attemptDueAt(now.getTime(), 1, hours);
          const t = await setNextActionTx(tx, r.id, {
            title: attemptTitle(next, r.name), dueAt: planned > earliest ? planned : earliest,
            assigneeId: await activeOwnerTx(tx, r.ownerId), meta: { ...ATTEMPT_META, tentativa: next },
          }, null, now);
          await tx.update(deals).set({ followupAttempt: next, followupDueAt: t.dueAt, followupTaskId: t.id }).where(eq(deals.id, r.id));
        } else {
          await tx.update(deals).set({ followupAttempt: MAX_ATTEMPTS + 1, followupDueAt: attemptDueAt(now.getTime(), LAST_REPLY_DAYS, hours), followupTaskId: null }).where(eq(deals.id, r.id));
        }
        return "advanced";
      });
      if (did) { out[did]++; await emit(did === "lost" ? "etapa_alterada" : "lead_atualizado", { dealId: r.id }); }
    } catch (e) { out.errors.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}

export const ATTENDED_CLOSE_DAYS = 3;
const POST_TASK_MAX_AGE_MS = 48 * 3_600_000;

async function openNextActionTx(tx: Tx, dealId: string) {
  const [t] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  return t ?? null;
}

/**
 * Compareceu (CRM, Agenda ou Avec): Atendida. Visita recente (até 48 h) e sem próxima ação combinada: abre o pós-atendimento
 * para a dona (agradecer, pedir foto e avaliação) no dia seguinte, 9h. A migração passa `postTask: false` (visitas antigas).
 */
export async function enterAttendedTx(tx: Tx, dealId: string, userId: string | null, reason: string, at: Date, opts: { visitAt?: Date; postTask?: boolean } = {}) {
  const deal = await moveToKindTx(tx, dealId, "atendido", userId, reason, at);
  const visit = opts.visitAt ?? at;
  if (opts.postTask === false || at.getTime() - visit.getTime() > POST_TASK_MAX_AGE_MS || await openNextActionTx(tx, dealId)) return deal;
  const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
  const next = nextDayMorning(visit);
  await setNextActionTx(tx, dealId, {
    title: `Pós-atendimento de ${clientFirstName(c?.name)}: agradecer, pedir foto e avaliação`,
    dueAt: next.getTime() > at.getTime() ? next : new Date(at.getTime() + 3_600_000),
    assigneeId: await activeOwnerTx(tx, deal.ownerId), meta: { ...POS_ATENDIMENTO_META },
  }, userId, at);
  return deal;
}

/** Faltou ou cancelou sem horário novo: Em conversa esperando a cliente, com "Remarcar" como 1ª tentativa (ou a próxima ação futura que já estava combinada). */
export async function enterMissedTx(tx: Tx, dealId: string, userId: string | null, reason: string, now: Date): Promise<{ remarcar: boolean }> {
  const [d] = await tx.select({ name: contacts.name, phone: contacts.phoneE164, ownerId: deals.ownerId }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  await cancelOpenTasksByOriginTx(tx, dealId, POS_ATENDIMENTO_META.origem, userId); // era um Compareceu corrigido: o pós não vale mais
  const open = await openNextActionTx(tx, dealId);
  const keep = !!open && open.dueAt.getTime() >= now.getTime();
  await waitForClientTx(tx, dealId, userId, reason, now, keep ? {} : {
    resumeAt: remarcarDueAt(now), taskTitle: `Remarcar com ${clientFullName(d?.name?.trim() || d?.phone)}`, taskMeta: { ...REMARCAR_META },
    assigneeId: await activeOwnerTx(tx, d?.ownerId ?? null),
  });
  return { remarcar: !keep };
}

/**
 * Fim do atendimento (nova organização, 16/10: a etapa Fechado saiu da escolha; "o salão não fecha venda, ele atende").
 * A conversa fica em Atendida, termina (`closedAt`: os relatórios contam como venda) e é encerrada; a espera e os avisos se resolvem.
 * Sem valor no lead, usa o total das comandas da cliente no dia da visita (Avec). Mensagem nova dela abre uma conversa nova.
 */
export async function closeAttendedTx(tx: Tx, dealId: string, userId: string | null, reason: string, at: Date, opts: { visitAt?: Date | null } = {}) {
  const [d] = await tx.select({ valueCents: deals.valueCents, contactId: deals.contactId, attendanceAt: deals.attendanceAt, enteredAt: deals.stageEnteredAt })
    .from(deals).where(eq(deals.id, dealId));
  if (!d) throw new Error("Conversa não encontrada");
  if (d.valueCents == null) {
    const visit = opts.visitAt ?? d.attendanceAt ?? d.enteredAt;
    const [s] = (await tx.execute(sql`select sum(total_cents)::int as cents from sales_items where contact_id = ${d.contactId}
      and sold_on = (${visit.toISOString()}::timestamptz at time zone 'America/Bahia')::date`)).rows as { cents: number | null }[];
    if (s?.cents) await tx.update(deals).set({ valueCents: s.cents }).where(eq(deals.id, dealId));
  }
  const deal = await moveToKindTx(tx, dealId, "atendido", userId, reason, at);
  if (deal.closedAt) return deal;
  const [closed] = await tx.update(deals).set({ closedAt: at, awaitingReplySince: null, conversationArchivedAt: sql`coalesce(${deals.conversationArchivedAt}, ${at.toISOString()}::timestamptz)` })
    .where(eq(deals.id, dealId)).returning();
  await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
  await logEvent(tx, dealId, "conversa_arquivada", { motivo: reason, atendimentoConcluido: true }, userId);
  return closed;
}

/** Nome antigo (o Lote 1C fechava em "Fechado"): hoje termina em Atendida, ver `closeAttendedTx`. */
export const closeAsWonTx = closeAttendedTx;

/** Worker: Atendida há 3 dias termina (continua em Atendida, encerrada e contada como venda). */
export async function closeAttendedDeals(now = new Date()): Promise<{ closed: number; errors: string[] }> {
  const limit = new Date(now.getTime() - ATTENDED_CLOSE_DAYS * 86_400_000);
  const rows = await db.select({ id: deals.id }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
    .where(and(eq(stages.kind, "atendido"), isNull(deals.closedAt), isNull(deals.archivedAt), lte(deals.stageEnteredAt, limit)));
  const out = { closed: 0, errors: [] as string[] };
  for (const r of rows) {
    try {
      await db.transaction((tx) => closeAttendedTx(tx, r.id, null, "atendida_3_dias", now));
      await emit("etapa_alterada", { dealId: r.id });
      out.closed++;
    } catch (e) { out.errors.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
