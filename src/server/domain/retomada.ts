import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, contacts, deals, outbox, tasks } from "../db/schema";
import { markWaitingForClient } from "./funnel";
import { cancelScheduled, iaPlaceholder, scheduleMessage, scheduledOf, sendScheduledNow, SCHEDULED_SOURCE } from "./scheduled";
import { funcaoLigada } from "./funcoes";
import { stopAttemptsTx } from "./attempts";
import { completeTaskTx } from "./tasks";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";
import { clientFirstName } from "../../lib/attempts";
import { fillFirstName } from "../../lib/retomada";
import { dueLabel } from "../../lib/next-action";

/**
 * Retomada (nova organização, 16/10): UMA ação para "Retomar depois", "Próxima ação", "Agendar mensagem" e "Mensagem agendada".
 * Dia, hora, motivo e uma mensagem opcional. Sem texto vira lembrete para quem marcou (a próxima ação, com as tentativas onde valem);
 * com texto, além do lembrete, a mensagem programada sai sozinha na hora (outbox "agendada"), ligada à tarefa por `options.taskId`:
 * saiu → a tarefa conta como feita; a cliente escreveu antes (com "Cancelar se ela responder antes") → as duas são canceladas.
 */
/** `ia`: o que a IA deve dizer (Retomada pela IA); sem texto e sem `ia`, com a função ligada, vale o motivo. */
export type ResumeInput = { dueAt: Date; motivo?: string | null; texto?: string | null; cancelIfReply?: boolean; assigneeId?: string | null; ia?: string | null };
export type ResumeResult = { dueAt: Date; taskId: string | null; outboxId: string | null };

const linkedPending = (taskId: string) => and(eq(outbox.status, "pending"), sql`${outbox.options}->>'source' = ${SCHEDULED_SOURCE}`, sql`${outbox.options}->>'taskId' = ${taskId}`);

async function openNextAction(dealId: string) {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  return t ?? null;
}

/** As mensagens programadas ainda pendentes ligadas à retomada aberta (no máximo uma, mas o legado pode ter mais). */
async function cancelLinkedOf(taskId: string | null | undefined, userId: string) {
  if (!taskId) return;
  const rows = await db.select({ id: outbox.id }).from(outbox).where(linkedPending(taskId));
  for (const r of rows) await cancelScheduled(r.id, userId).catch(() => {});
}

export async function resume(dealId: string, input: ResumeInput, userId: string, now = new Date()): Promise<ResumeResult> {
  const texto = input.texto?.trim() || null;
  if (texto && texto.length > 4000) throw new UserFacingError("Mensagem muito longa (máximo 4.000 caracteres).");
  const [row] = await db.select({ name: contacts.name, nickname: contacts.nickname }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) throw new UserFacingError("Essa conversa não existe mais.");
  const motivo = input.motivo?.trim() || (texto ? "Mensagem programada" : `Retomar contato com ${clientFirstName(row.name)}`);
  const before = await openNextAction(dealId);
  // A mensagem primeiro: é ela que confere a hora (5 min a 60 dias). Se a retomada falhar depois, a mensagem é cancelada.
  // Sem texto, com a Retomada pela IA ligada (29/10, pedido da Thaise): a IA escreve e envia na hora, a partir do que a atendente disse ou do motivo.
  // Se não der para programar (número oculto, longe demais, 5 por cliente), fica só o lembrete, como antes.
  const ia = !texto && await funcaoLigada("retomada_ia") ? (input.ia?.trim() || motivo).slice(0, 300) : null;
  const scheduled = texto
    ? await scheduleMessage({ dealId, text: fillFirstName(texto, row.nickname || row.name), at: input.dueAt, cancelIfReply: input.cancelIfReply !== false }, userId, now)
    : ia ? await scheduleMessage({ dealId, text: iaPlaceholder(ia), ia, at: input.dueAt, cancelIfReply: input.cancelIfReply !== false }, userId, now).catch(() => null)
    : null;
  try {
    await markWaitingForClient(dealId, { resumeAt: input.dueAt, title: motivo, ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}) }, userId, now);
  } catch (e) {
    if (scheduled) await cancelScheduled(scheduled.id, userId).catch(() => {});
    throw e;
  }
  // Trocar: a mensagem programada da retomada de antes não sai mais. Só depois que a nova deu certo: hora inválida não apaga a que já existia.
  await cancelLinkedOf(before?.id, userId);
  const task = await openNextAction(dealId);
  if (scheduled && task) {
    await db.update(outbox).set({ options: sql`${outbox.options} || ${JSON.stringify({ taskId: task.id })}::jsonb` }).where(eq(outbox.id, scheduled.id));
  }
  await logEvent(db, dealId, "retomada", { para: input.dueAt.toISOString(), mensagem: !!scheduled, ...(ia && scheduled ? { ia: true } : {}), tarefa: task?.id ?? null }, userId);
  await emit("lead_atualizado", { dealId });
  return { dueAt: task?.dueAt ?? input.dueAt, taskId: task?.id ?? null, outboxId: scheduled?.id ?? null };
}

/** O motivo do lembrete que nasce da sugestão da IA (a cliente cancelou sem nova data). */
export const RETOMADA_IA_MOTIVO = "Retomar: cancelou sem remarcar";
/** Há retomada aberta nesta conversa? (a sugestão não propõe outra por cima) */
export async function hasOpenResume(dealId: string): Promise<boolean> {
  return !!(await openNextAction(dealId));
}
/**
 * "Programar retomada" da sugestão da IA (Cati 17/10): o toque da atendente cria o lembrete pelo MESMO caminho do "Retomar…" (`resume`), no dia
 * que a sugestão propôs. Só lembrete: nenhuma mensagem é programada nem enviada. Já tem retomada aberta → não troca (avisa).
 */
export async function resumeFromSuggestion(suggestionId: string, dealId: string, userId: string, now = new Date()): Promise<ResumeResult> {
  const [s] = await db.select({ retomarEm: aiSuggestions.retomarEm }).from(aiSuggestions).where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.dealId, dealId)));
  if (!s?.retomarEm) throw new UserFacingError("Esta sugestão não tem retomada para programar.");
  if (s.retomarEm.getTime() < now.getTime() + 5 * 60_000) throw new UserFacingError("Essa data já passou. Use Retomar… para escolher outra.");
  const aberta = await openNextAction(dealId);
  if (aberta) throw new UserFacingError(`Esta conversa já tem retomada marcada (${dueLabel(aberta.dueAt.getTime(), now.getTime())}).`);
  return resume(dealId, { dueAt: s.retomarEm, motivo: RETOMADA_IA_MOTIVO }, userId, now);
}

/** "Feito": a retomada conta como feita (a varredura das tentativas segue); a mensagem programada dela não sai mais. */
export async function doneResume(dealId: string, userId: string, now = new Date()): Promise<void> {
  const t = await openNextAction(dealId);
  if (!t) throw new UserFacingError("Essa conversa não tem retomada aberta.");
  await cancelLinkedOf(t.id, userId);
  await db.transaction((tx) => completeTaskTx(tx, t.id, userId, "concluida", now));
  await emit("lead_atualizado", { dealId });
}

/** "Cancelar": tira a retomada (e a mensagem programada dela); as tentativas param. */
export async function cancelResume(dealId: string, userId: string, now = new Date()): Promise<void> {
  const t = await openNextAction(dealId);
  if (!t) throw new UserFacingError("Essa conversa não tem retomada aberta.");
  await cancelLinkedOf(t.id, userId);
  await db.transaction(async (tx) => {
    await completeTaskTx(tx, t.id, userId, "cancelada", now);
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (d) await stopAttemptsTx(tx, d, userId, now);
    await logEvent(tx, dealId, "retomada_cancelada", { tarefa: t.id }, userId);
  });
  await emit("lead_atualizado", { dealId });
}

/**
 * Resolver ou marcar Perdido com mensagem programada pendente (P5, 17/10): a tela pergunta "Manter a mensagem de …?" e, em Cancelar,
 * chama esta. Cancela as programadas pendentes da cliente (as que a conversa mostra) e a retomada ligada a cada uma (o lembrete era ela).
 * Devolve quantas cancelou.
 */
export async function cancelPendingMessages(dealId: string, userId: string, now = new Date()): Promise<number> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  let n = 0;
  for (const item of await scheduledOf(d.contactId)) {
    const ok = await cancelScheduled(item.id, userId, "Cancelada ao resolver a conversa (Resolvido ou Perdido).").then(() => true, () => false);
    if (!ok) continue;
    n++;
    const taskId = item.taskId;
    if (taskId) await db.transaction(async (tx) => {
      const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.doneAt)));
      if (t) await completeTaskTx(tx, t.id, userId, "cancelada", now);
    });
  }
  if (n) await emit("lead_atualizado", { dealId });
  return n;
}

/** "Enviar agora" da mensagem programada: sai já, assinada por quem tocou, e a retomada ligada conta como feita. */
export async function sendResumeNow(outboxId: string, userId: string, now = new Date()): Promise<void> {
  const [o] = await db.select({ options: outbox.options, dealId: outbox.dealId }).from(outbox).where(eq(outbox.id, outboxId));
  await sendScheduledNow(outboxId, userId, now);
  const taskId = o?.options && !Array.isArray(o.options) ? (o.options as { taskId?: string }).taskId : undefined;
  if (taskId) await db.transaction((tx) => completeTaskTx(tx, taskId, userId, "concluida", now));
  if (o) await emit("lead_atualizado", { dealId: o.dealId });
}

/** Texto gravado no item substituído por "Editar" (fica fora de "não saíram" em Mensagens programadas). */
export const EDITED_ERROR = "Editada.";
/**
 * "Editar" em Mensagens programadas: a mensagem antiga dá lugar a uma retomada nova (texto, dia e hora) na mesma conversa.
 * Se a nova não puder ser programada (hora passada, mais de 60 dias), a antiga volta como estava.
 */
export async function editScheduled(outboxId: string, input: ResumeInput, userId: string, now = new Date()): Promise<ResumeResult> {
  const [item] = await db.update(outbox).set({ status: "cancelled", error: EDITED_ERROR })
    .where(and(eq(outbox.id, outboxId), eq(outbox.status, "pending"), sql`${outbox.options}->>'source' = ${SCHEDULED_SOURCE}`)).returning();
  if (!item) throw new UserFacingError("Essa mensagem já saiu ou já foi cancelada.");
  try {
    return await resume(item.dealId, input, userId, now);
  } catch (e) {
    await db.update(outbox).set({ status: "pending", error: null }).where(and(eq(outbox.id, outboxId), eq(outbox.status, "cancelled")));
    throw e;
  }
}

/** Retomar em lote: a mesma retomada para cada conversa marcada; o 1º nome entra sozinho; as mensagens saem 1 a cada 20 s. */
export const BULK_RESUME_GAP_MS = 20_000;
export async function bulkResume(dealIds: string[], input: ResumeInput, userId: string, now = new Date()): Promise<{ ok: number; failed: { dealId: string; error: string }[] }> {
  const out = { ok: 0, failed: [] as { dealId: string; error: string }[] };
  let i = 0;
  for (const dealId of [...new Set(dealIds)]) {
    try {
      const at = input.texto?.trim() || input.ia?.trim() ? new Date(input.dueAt.getTime() + i * BULK_RESUME_GAP_MS) : input.dueAt;
      await resume(dealId, { ...input, dueAt: at }, userId, now);
      out.ok++; i++;
    } catch (e) { out.failed.push({ dealId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}
