import { and, asc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, tasks, type Task } from "../db/schema";
import { logEvent, emit } from "./events";

export const TASK_KINDS = ["proxima_acao", "retorno", "comparecimento", "geral"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type NewTask = { dealId?: string | null; contactId: string; kind: TaskKind; title: string; dueAt: Date; assigneeId?: string | null };

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
  if (t.dealId) await logEvent(tx, t.dealId, "tarefa", { acao: "criada", tarefa: t.id, tipo: t.kind, titulo: t.title, para: t.dueAt.toISOString() }, userId);
  return t;
}

export async function createTask(input: NewTask, userId: string): Promise<Task> {
  const t = await db.transaction((tx) => createTaskTx(tx, input, userId));
  await emit("lead_atualizado", { dealId: t.dealId ?? undefined });
  return t;
}

export async function completeTask(id: string, userId: string): Promise<Task> {
  const now = new Date();
  const t = await db.transaction(async (tx) => {
    const [row] = await tx.update(tasks).set({ doneAt: now }).where(and(eq(tasks.id, id), isNull(tasks.doneAt))).returning();
    if (!row) {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, id));
      if (!existing) throw new Error("Tarefa não encontrada");
      return existing; // já concluída: não duplica o evento
    }
    // O aviso de "vencendo" some junto com a tarefa.
    await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.waitKey, `task:${id}`), isNull(alerts.resolvedAt)));
    if (row.dealId) await logEvent(tx, row.dealId, "tarefa", { acao: "concluida", tarefa: row.id, tipo: row.kind, titulo: row.title }, userId);
    return row;
  });
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

/** Troca a tarefa em aberto de um tipo por outra (ou só remove, se `next` for null). Usado por agendamento e venda. */
export async function replaceOpenTaskTx(tx: Tx, dealId: string, contactId: string, kind: "comparecimento" | "retorno", next: { title: string; dueAt: Date; assigneeId: string | null } | null, userId: string | null) {
  await tx.delete(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, kind), isNull(tasks.doneAt)));
  if (next) await createTaskTx(tx, { dealId, contactId, kind, ...next }, userId);
}

/**
 * Lembretes (worker, a cada 5 min): tarefa com responsável que vence nos próximos 15 min e ainda não foi avisada
 * vira um alerta `tarefa_vencendo` (nível 1) para o responsável. `wait_key = task:<id>` garante um só aviso por tarefa.
 */
export async function remindDueTasks(now = new Date()): Promise<{ alerts: number }> {
  const until = new Date(now.getTime() + 15 * 60_000);
  const due = await db.select({ t: tasks, contactName: contacts.name, phone: contacts.phoneE164 }).from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(
      isNull(tasks.doneAt), gte(tasks.dueAt, now), lte(tasks.dueAt, until), isNotNull(tasks.assigneeId),
      or(isNull(tasks.dealId), isNull(deals.archivedAt)), eq(contacts.ignored, false),
    ));
  let created = 0;
  for (const { t, contactName, phone } of due) {
    if (!t.assigneeId) continue;
    const quem = contactName?.trim() || phone;
    const [row] = await db.insert(alerts).values({
      dealId: t.dealId, userId: t.assigneeId, audience: "responsavel", type: "tarefa_vencendo", severity: "info",
      message: `${t.title} — ${quem}`, dedupeKey: `task:${t.id}`, waitKey: `task:${t.id}`, level: 1, createdAt: now,
    }).onConflictDoNothing().returning({ id: alerts.id });
    if (row) { created++; await emit("regras", { deals: t.dealId ? [t.dealId] : [] }); }
  }
  return { alerts: created };
}
