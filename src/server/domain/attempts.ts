import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { contacts, deals, stages, tasks, users, type Deal } from "../db/schema";
import { getBusinessHours } from "./hours";
import { completeTaskTx, setNextActionTx } from "./tasks";
import { MAX_ATTEMPTS, attemptDaysOf, attemptDueAt, attemptTitle, type WaitingKind } from "../../lib/attempts";

/** Marca (no evento de criação da tarefa) das tentativas: só essas são canceladas quando a conversa sai de Aguardando/Orçamento. */
export const ATTEMPT_META = { origem: "tentativa" } as const;

export type AttemptStart = {
  /** Sem tentativas (convite de retorno da mensagem em massa: a Casa já escreveu; só espera a cliente). */
  noAttempts?: boolean;
  /** "Retomar em": quando é a 1ª tentativa. Sem isso: D+1 (Orçamento: D+2), 10h, no próximo dia de expediente. */
  resumeAt?: Date | null;
  /** Título da 1ª tentativa (padrão "Tentativa 1 de 3: retomar contato com <nome>"). */
  taskTitle?: string;
  /** Quem retoma (padrão: a dona, se ainda está ativa na equipe). */
  assigneeId?: string | null;
  /** Marca no evento da tarefa (padrão { origem: "tentativa", tentativa: 1 }). */
  taskMeta?: Record<string, unknown>;
};

/** A dona, se ainda está ativa; senão ninguém (tarefa nunca derruba a mudança de etapa por causa de quem saiu da equipe). */
export async function activeOwnerTx(tx: Tx, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.active, true)));
  return u?.id ?? null;
}

/**
 * Entrou em Aguardando cliente / Orçamento enviado: tentativa 1. A próxima ação futura que a equipe já combinou vira a tentativa;
 * senão nasce "Tentativa 1 de 3" (ou o título pedido) na data pedida ou em D+1/D+2. Lead arquivado ganha o contador, sem tarefa.
 */
export async function startAttemptsTx(tx: Tx, deal: Deal, kind: WaitingKind, userId: string | null, at: Date, opts: AttemptStart = {}): Promise<Deal> {
  const [open] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, deal.id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  let taskId: string | null = null;
  let dueAt: Date;
  if (!opts.resumeAt && open && open.dueAt.getTime() >= at.getTime()) {
    taskId = open.id; dueAt = open.dueAt;
  } else {
    const [st] = await tx.select({ attemptDays: stages.attemptDays }).from(stages).where(eq(stages.id, deal.stageId));
    dueAt = opts.resumeAt ?? attemptDueAt(at.getTime(), attemptDaysOf(kind, st?.attemptDays)[0], await getBusinessHours(tx));
    if (!deal.archivedAt) {
      const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
      const t = await setNextActionTx(tx, deal.id, {
        title: opts.taskTitle ?? attemptTitle(1, c?.name), dueAt,
        assigneeId: opts.assigneeId !== undefined ? opts.assigneeId : await activeOwnerTx(tx, deal.ownerId),
        meta: opts.taskMeta ?? { ...ATTEMPT_META, tentativa: 1 },
      }, userId, at);
      taskId = t.id; dueAt = t.dueAt;
    }
  }
  const [u] = await tx.update(deals).set({ followupAttempt: 1, followupDueAt: dueAt, followupTaskId: taskId }).where(eq(deals.id, deal.id)).returning();
  return u;
}

const isAttemptTaskTx = async (tx: Tx, dealId: string, taskId: string) =>
  (await tx.execute(sql`select 1 from deal_events e where e.deal_id = ${dealId} and e.type = 'tarefa' and e.payload->>'acao' = 'criada'
    and e.payload->>'tarefa' = ${taskId} and e.payload->>'origem' = ${ATTEMPT_META.origem} limit 1`)).rows.length > 0;

/**
 * Para as tentativas (a cliente respondeu em Em conversa, ou a conversa saiu da espera): cancela a tentativa em aberto (só a das tentativas)
 * e zera o contador. Não muda a etapa.
 */
export async function stopAttemptsTx(tx: Tx, deal: Deal, userId: string | null, at: Date): Promise<void> {
  if (deal.followupAttempt <= 0 && !deal.followupTaskId) return;
  await cancelAttemptTaskTx(tx, deal, userId, at);
  await tx.update(deals).set({ followupAttempt: 0, followupDueAt: null, followupTaskId: null }).where(eq(deals.id, deal.id));
}

/** Saiu de Aguardando/Orçamento: cancela a tentativa em aberto (só a criada pelas tentativas; "Remarcar" e o que a equipe escreveu ficam). */
export async function cancelAttemptTaskTx(tx: Tx, deal: Deal, userId: string | null, at: Date) {
  if (deal.followupTaskId && await isAttemptTaskTx(tx, deal.id, deal.followupTaskId)) await completeTaskTx(tx, deal.followupTaskId, userId, "cancelada", at);
}

/** Já aguardando: só troca a data (e o título) da tentativa atual. Com as 3 feitas, volta a ser a 3ª. */
export async function rescheduleAttemptTx(tx: Tx, dealId: string, input: { resumeAt: Date; title?: string; assigneeId?: string | null }, userId: string | null, now: Date): Promise<{ dueAt: Date }> {
  const [d] = await tx.select({ attempt: deals.followupAttempt, ownerId: deals.ownerId, name: contacts.name }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  const n = Math.min(Math.max(d?.attempt ?? 1, 1), MAX_ATTEMPTS);
  const t = await setNextActionTx(tx, dealId, {
    title: input.title ?? attemptTitle(n, d?.name), dueAt: input.resumeAt,
    assigneeId: input.assigneeId !== undefined ? input.assigneeId : await activeOwnerTx(tx, d?.ownerId ?? null),
    meta: { ...ATTEMPT_META, tentativa: n },
  }, userId, now);
  await tx.update(deals).set({ followupAttempt: n, followupDueAt: t.dueAt, followupTaskId: t.id }).where(eq(deals.id, dealId));
  return { dueAt: t.dueAt };
}

/** Conversa que JÁ estava em Aguardando antes do Lote 1C (sem contador): vira tentativa 1 mantendo a próxima ação aberta, mesmo vencida. */
export async function adoptWaitingTx(tx: Tx, deal: Deal, kind: WaitingKind, at: Date): Promise<Deal> {
  if (deal.followupAttempt > 0) return deal;
  const [open] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, deal.id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  if (!open) return startAttemptsTx(tx, deal, kind, null, at);
  const [u] = await tx.update(deals).set({ followupAttempt: 1, followupDueAt: open.dueAt, followupTaskId: open.id }).where(eq(deals.id, deal.id)).returning();
  return u;
}
