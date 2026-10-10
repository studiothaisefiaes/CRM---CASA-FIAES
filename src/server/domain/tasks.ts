import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, tasks, users, type Task } from "../db/schema";
import { UserFacingError } from "./errors";
import { logEvent, emit } from "./events";
import { bahiaAt } from "../../lib/next-action";

export const TASK_KINDS = ["proxima_acao", "retorno", "comparecimento", "geral"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type NewTask = { dealId?: string | null; contactId: string; kind: TaskKind; title: string; dueAt: Date; assigneeId?: string | null;
  /** Marca guardada no evento de criação (ex.: `{ origem: "faltou" }`), para achar a tarefa depois sem casar pelo título. */ meta?: Record<string, unknown> };

const DAY_MS = 86_400_000;
const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão

/** 09h (Salvador) do dia seguinte ao instante dado, calculado no fuso de Salvador (não em UTC). */
export function nextDayMorning(at: Date): Date {
  const local = new Date(at.getTime() - BAHIA_OFFSET_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(dayStart + DAY_MS + 9 * 3_600_000 + BAHIA_OFFSET_MS);
}

export async function createTaskTx(tx: Tx, input: NewTask, userId: string | null): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new Error("Escreva o que precisa ser feito");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("Data inválida");
  const [t] = await tx.insert(tasks).values({
    dealId: input.dealId ?? null, contactId: input.contactId, kind: input.kind, title,
    dueAt: input.dueAt, assigneeId: input.assigneeId ?? null, createdBy: userId,
  }).returning();
  if (t.dealId) await logEvent(tx, t.dealId, "tarefa", { acao: "criada", tarefa: t.id, tipo: t.kind, titulo: t.title, para: t.dueAt.toISOString(), ...(input.meta ?? {}) }, userId);
  return t;
}

export async function createTask(input: NewTask, userId: string): Promise<Task> {
  const t = await db.transaction((tx) => createTaskTx(tx, input, userId));
  await emit("lead_atualizado", { dealId: t.dealId ?? undefined });
  return t;
}

/** Conclui (ou cancela) a tarefa e resolve o aviso `task:<id>`. Idempotente: se já estava concluída, não repete o evento. */
export async function completeTaskTx(tx: Tx, id: string, userId: string | null, acao: "concluida" | "cancelada" = "concluida", at = new Date()): Promise<Task> {
  const [row] = await tx.update(tasks).set({ doneAt: at }).where(and(eq(tasks.id, id), isNull(tasks.doneAt))).returning();
  if (!row) {
    const [existing] = await tx.select().from(tasks).where(eq(tasks.id, id));
    if (!existing) throw new Error("Tarefa não encontrada");
    return existing;
  }
  await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.waitKey, `task:${id}`), isNull(alerts.resolvedAt)));
  if (row.dealId) await logEvent(tx, row.dealId, "tarefa", { acao, tarefa: row.id, tipo: row.kind, titulo: row.title }, userId);
  return row;
}

export async function completeTask(id: string, userId: string): Promise<Task> {
  const t = await db.transaction((tx) => completeTaskTx(tx, id, userId));
  await emit("lead_atualizado", { dealId: t.dealId ?? undefined });
  return t;
}

/** Tarefas em aberto com vencimento até `dueBefore`, da mais urgente para a menos. */
export async function listTasks(opts: { assigneeId?: string; dueBefore: Date; open: true }) {
  return db.select().from(tasks)
    .where(and(isNull(tasks.doneAt), lte(tasks.dueAt, opts.dueBefore), opts.assigneeId ? eq(tasks.assigneeId, opts.assigneeId) : undefined))
    .orderBy(asc(tasks.dueAt));
}

/** A tarefa `proxima_acao` em aberto mais próxima do lead. */
export async function nextActionOf(dealId: string): Promise<Task | null> {
  const [t] = await db.select().from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)))
    .orderBy(asc(tasks.dueAt)).limit(1);
  return t ?? null;
}

/** Cancela a tarefa em aberto de um tipo e cria a nova (ou só remove, se `next` for null). Usado por agendamento e venda. */
export async function replaceOpenTaskTx(tx: Tx, dealId: string, contactId: string, kind: "proxima_acao" | "comparecimento" | "retorno", next: { title: string; dueAt: Date; assigneeId: string | null; meta?: Record<string, unknown> } | null, userId: string | null) {
  const open = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, kind), isNull(tasks.doneAt)));
  for (const t of open) await completeTaskTx(tx, t.id, userId, "cancelada"); // cancela (guarda o histórico), não apaga
  if (next) await createTaskTx(tx, { dealId, contactId, kind, ...next }, userId);
}

export const NEXT_ACTION_TITLE_MAX = 120;
/** Tolerância para "agora": quem abre a folha e demora para confirmar não leva erro por alguns minutos. */
const PAST_GRACE_MS = 5 * 60_000;

/**
 * Define a próxima ação do lead: UMA aberta por lead. Se já existia, ela é cancelada (fica no histórico) e a nova entra no lugar.
 * O responsável tem de ser alguém ativo da equipe; sem responsável, vale o dono do lead.
 */
export async function setNextActionTx(tx: Tx, dealId: string, input: { title: string; dueAt: Date; assigneeId?: string | null; meta?: Record<string, unknown> }, userId: string | null, now = new Date()): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new UserFacingError("Escreva o que precisa ser feito.");
  if (title.length > NEXT_ACTION_TITLE_MAX) throw new UserFacingError(`Resuma em até ${NEXT_ACTION_TITLE_MAX} caracteres.`);
  if (Number.isNaN(input.dueAt.getTime())) throw new UserFacingError("Escolha a data e a hora.");
  if (input.dueAt.getTime() < now.getTime() - PAST_GRACE_MS) throw new UserFacingError("Essa data já passou. Escolha uma data futura.");
  const [deal] = await tx.select({ contactId: deals.contactId, ownerId: deals.ownerId, archivedAt: deals.archivedAt }).from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new UserFacingError("Lead não encontrado");
  if (deal.archivedAt) throw new UserFacingError("Esse lead saiu da fila.");
  const assigneeId = input.assigneeId === undefined ? deal.ownerId : input.assigneeId;
  if (assigneeId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, assigneeId), eq(users.active, true)));
    if (!u) throw new UserFacingError("Essa pessoa não está mais na equipe.");
  }
  await replaceOpenTaskTx(tx, dealId, deal.contactId, "proxima_acao", { title, dueAt: input.dueAt, assigneeId, ...(input.meta ? { meta: input.meta } : {}) }, userId);
  const [t] = await tx.select().from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
  return t;
}

export async function setNextAction(dealId: string, input: { title: string; dueAt: Date; assigneeId?: string | null }, userId: string): Promise<Task> {
  const t = await db.transaction((tx) => setNextActionTx(tx, dealId, input, userId));
  await emit("lead_atualizado", { dealId });
  return t;
}

/** Marca (no evento de criação) da próxima ação que o "Faltou" cria. */
export const REMARCAR_META = { origem: "faltou" } as const;

/** Cancela o "Remarcar" aberto que o Faltou criou (identificado pela marca no evento, nunca pelo título). Quem já trocou a ação não é tocado. */
export async function cancelRemarcarTx(tx: Tx, dealId: string, userId: string | null): Promise<number> {
  const open = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt),
    sql`exists (select 1 from deal_events e where e.deal_id = ${tasks.dealId} and e.type = 'tarefa' and e.payload->>'acao' = 'criada'
      and e.payload->>'tarefa' = ${tasks.id}::text and e.payload->>'origem' = ${REMARCAR_META.origem})`));
  for (const t of open) await completeTaskTx(tx, t.id, userId, "cancelada");
  return open.length;
}

/** Quando o "Remarcar" de quem faltou deve aparecer: 10h de amanhã (Salvador). */
export const remarcarDueAt = (now: Date) => bahiaAt(now.getTime(), 1, 10);

/**
 * Lembretes (worker, a cada 5 min): tarefa com responsável que vence nos próximos 15 min (ou venceu há até 2 dias)
 * e ainda não foi avisada vira um alerta `tarefa_vencendo` (nível 1) para o responsável, ou para a gestão se não tem responsável. `wait_key = task:<id>` garante um só aviso por tarefa.
 */
export async function remindDueTasks(now = new Date()): Promise<{ alerts: number }> {
  const until = new Date(now.getTime() + 15 * 60_000);
  const floor = new Date(now.getTime() - 2 * 86_400_000); // vencida há mais de 2 dias não avisa (evita rajada ao religar o worker)
  const due = await db.select({ t: tasks, contactName: contacts.name, phone: contacts.phoneE164 }).from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(
      isNull(tasks.doneAt), gte(tasks.dueAt, floor), lte(tasks.dueAt, until),
      or(isNull(tasks.dealId), isNull(deals.archivedAt)), eq(contacts.ignored, false),
    ));
  let created = 0;
  for (const { t, contactName, phone } of due) {
    const quem = contactName?.trim() || phone;
    const [row] = await db.insert(alerts).values({
      dealId: t.dealId, userId: t.assigneeId, audience: t.assigneeId ? "responsavel" : "gestao", type: "tarefa_vencendo", severity: "info",
      message: `${t.title} — ${quem}`, dedupeKey: `task:${t.id}`, waitKey: `task:${t.id}`, level: 1, createdAt: now,
    }).onConflictDoNothing().returning({ id: alerts.id });
    if (row) { created++; await emit("regras", { deals: t.dealId ? [t.dealId] : [] }); }
  }
  return { alerts: created };
}
