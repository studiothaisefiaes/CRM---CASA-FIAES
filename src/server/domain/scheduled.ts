import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, outbox, tasks, users, type OutboxItem } from "../db/schema";
import { completeTaskTx } from "./tasks";
import { isHiddenNumber } from "@/lib/phone-client";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { dueLabel } from "@/lib/next-action";
import { findOpenDeal } from "./deals";
import { sendFromCrm } from "./send";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

export const SCHEDULED_SOURCE = "agendada";
export const SCHEDULE_MIN_AHEAD_MS = 5 * 60_000;
export const SCHEDULE_MAX_DAYS = 60;
export const SCHEDULED_PER_CONTACT = 5;
/** Agendada que perdeu a hora (worker parado, Casa fechou) não sai sozinha depois disso: a autora decide. */
export const SCHEDULED_LATE_MS = 2 * 3_600_000;

export type ScheduledItem = { id: string; dealId: string; text: string; at: Date; authorName: string | null; cancelIfReply: boolean; /** A retomada (tarefa) a que a mensagem está ligada. */ taskId: string | null };
type Meta = { source?: string; cancelIfReply?: boolean; sendAt?: string; taskId?: string };
const metaOf = (o: OutboxItem["options"]): Meta => (o && !Array.isArray(o) ? o : {});
const isScheduled = sql`${outbox.options}->>'source' = ${SCHEDULED_SOURCE}`;
const pendingOf = (contactId: string) => and(eq(outbox.status, "pending"), isScheduled, eq(deals.contactId, contactId));

/**
 * Mensagem agendada (relógio ao lado do campo): fica no outbox com a hora escolhida e sai assinada por quem agendou.
 * Sai na hora marcada mesmo com a Casa fechada (16/10), de 5 min a 60 dias para a frente, no máximo 5 por cliente.
 * `cancelIfReply` (padrão: sim): se a cliente escrever antes da hora, não sai e a autora é avisada.
 */
export async function scheduleMessage(input: { dealId: string; text: string; at: Date; cancelIfReply?: boolean }, userId: string, now = new Date()): Promise<{ id: string; at: Date }> {
  const text = input.text.trim();
  if (!text) throw new UserFacingError("Escreva a mensagem antes de agendar.");
  if (text.length > 4000) throw new UserFacingError("Mensagem muito longa (máximo 4.000 caracteres).");
  const at = input.at;
  if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() + SCHEDULE_MIN_AHEAD_MS) throw new UserFacingError("Escolha um horário daqui a pelo menos 5 minutos.");
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) throw new UserFacingError(`Dá para agendar até ${SCHEDULE_MAX_DAYS} dias para a frente.`);
  // 16/10 (pedido do dono/Cati): a mensagem que a atendente programa sai na hora escolhida, mesmo com a Casa fechada (ela pode estar atendendo fora do horário).
  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, input.dealId));
  if (!row) throw new UserFacingError("Essa conversa não existe mais.");
  if (row.deal.archivedAt || row.contact.ignored) throw new UserFacingError("Esse contato está marcado como “Não é cliente”.");
  if (isHiddenNumber(row.contact.phoneE164)) throw new UserFacingError("Essa cliente está com o número oculto no WhatsApp: não dá para agendar por aqui.");
  const pending = await db.select({ id: outbox.id }).from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId)).where(pendingOf(row.contact.id));
  if (pending.length >= SCHEDULED_PER_CONTACT) throw new UserFacingError(`Esta conversa já tem ${SCHEDULED_PER_CONTACT} mensagens agendadas. Cancele uma antes.`);
  const [item] = await db.insert(outbox).values({
    dealId: input.dealId, kind: "text", text, notBefore: at, createdBy: userId, createdAt: now,
    options: { source: SCHEDULED_SOURCE, cancelIfReply: input.cancelIfReply !== false, sendAt: at.toISOString() },
  }).returning({ id: outbox.id });
  await logEvent(db, input.dealId, "mensagem_agendada", { outboxId: item.id, para: at.toISOString() }, userId);
  await emit("agendada", { dealId: input.dealId });
  return { id: item.id, at };
}

/** As agendadas que ainda vão sair (todas as conversas da cliente), da mais próxima para a mais distante. */
export async function scheduledOf(contactId: string): Promise<ScheduledItem[]> {
  const rows = await db.select({ id: outbox.id, dealId: outbox.dealId, text: outbox.text, notBefore: outbox.notBefore, options: outbox.options, authorName: users.name })
    .from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId)).leftJoin(users, eq(users.id, outbox.createdBy))
    .where(pendingOf(contactId)).orderBy(asc(outbox.notBefore));
  return rows.map((r) => {
    const m = metaOf(r.options);
    return { id: r.id, dealId: r.dealId, text: r.text, at: m.sendAt ? new Date(m.sendAt) : r.notBefore, authorName: r.authorName, cancelIfReply: m.cancelIfReply !== false, taskId: m.taskId ?? null };
  });
}

/** A conversa em que a mensagem entra: a aberta da cliente agora (a antiga pode ter fechado), senão a de quando agendou. */
async function targetDeal(dealId: string): Promise<string> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  return d ? (await findOpenDeal(d.contactId))?.id ?? dealId : dealId;
}

export async function cancelScheduled(id: string, userId: string, why = "Cancelada na conversa."): Promise<void> {
  const [item] = await db.update(outbox).set({ status: "cancelled", error: why })
    .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), isScheduled)).returning();
  if (!item) throw new UserFacingError("Essa mensagem já saiu ou já foi cancelada.");
  await logEvent(db, item.dealId, "agendada_cancelada", { outboxId: id }, userId);
  await emit("agendada", { dealId: item.dealId });
}

/** "Desfazer" do Cancelar (Mensagens programadas): volta a sair na hora marcada, se a hora ainda não chegou. */
export async function restoreScheduled(id: string, userId: string, now = new Date()): Promise<void> {
  const [item] = await db.update(outbox).set({ status: "pending", error: null })
    .where(and(eq(outbox.id, id), eq(outbox.status, "cancelled"), isScheduled,
      sql`coalesce((${outbox.options}->>'sendAt')::timestamptz, ${outbox.notBefore}) > ${new Date(now.getTime() + 60_000).toISOString()}::timestamptz`)).returning();
  if (!item) throw new UserFacingError("Não deu para desfazer: a hora já passou ou a mensagem mudou.");
  await logEvent(db, item.dealId, "mensagem_agendada", { outboxId: id, desfeito: true }, userId);
  await emit("agendada", { dealId: item.dealId });
}

/** "Enviar agora": reserva o item (o worker não pega mais) e manda na hora, assinada por quem clicou. */
export async function sendScheduledNow(id: string, userId: string, now = new Date()): Promise<void> {
  const [item] = await db.update(outbox).set({ status: "sending", attempts: sql`${outbox.attempts} + 1`, notBefore: now })
    .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), isScheduled)).returning();
  if (!item) throw new UserFacingError("Essa mensagem já saiu ou já foi cancelada.");
  try {
    await sendFromCrm(await targetDeal(item.dealId), item.text, userId);
  } catch (e) {
    await db.update(outbox).set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(outbox.id, id));
    await emit("agendada", { dealId: item.dealId });
    throw e;
  }
  await db.update(outbox).set({ status: "sent", sentAt: now, error: null }).where(eq(outbox.id, id));
  await emit("agendada", { dealId: item.dealId });
}

/**
 * Chamado pelo `drainOutbox` para um item "agendada", na hora: confere tudo de novo e envia como quem agendou.
 * Nunca reenvia: qualquer falha vira "não saiu" e a autora (ou a gestão) é avisada.
 */
export async function deliverScheduled(item: OutboxItem, now = new Date()): Promise<"sent" | "cancelled" | "failed"> {
  const meta = metaOf(item.options);
  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, item.dealId));
  /** A retomada ligada (Retomar com mensagem): saiu → feita; a cliente escreveu antes → cancelada. Falha deixa aberta (vira o lembrete). */
  const closeTask = async (acao: "concluida" | "cancelada") => {
    if (!meta.taskId) return;
    const taskId = meta.taskId;
    await db.transaction(async (tx) => { const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.doneAt))); if (t) await completeTaskTx(tx, t.id, null, acao, now); });
  };
  const finish = async (status: "cancelled" | "failed", why: string, notify: "autora" | "gestao" | null) => {
    await db.update(outbox).set({ status, error: why.slice(0, 300) }).where(eq(outbox.id, item.id));
    if (row && notify) {
      const toAuthor = notify === "autora" && !!item.createdBy;
      await db.insert(alerts).values({
        dealId: item.dealId, userId: toAuthor ? item.createdBy : null, audience: toAuthor ? "responsavel" : "gestao", type: "agendada_falhou", severity: "info",
        message: alertText.scheduledFailed(clientLabel(row.contact.name, row.contact.phoneE164), why), dedupeKey: `agendada:${item.id}`,
      }).onConflictDoNothing();
      await emit("alerta", { dealId: item.dealId });
    }
    await emit("agendada", { dealId: item.dealId });
    return status;
  };
  if (!row) return finish("cancelled", "a conversa não existe mais", null);
  if (row.contact.ignored || row.deal.archivedAt) return finish("cancelled", "o contato foi marcado como “Não é cliente”", "autora");
  // `notBefore` vira o instante da reserva quando o item é pego: a hora escolhida fica em `sendAt`.
  const sendAt = meta.sendAt ? new Date(meta.sendAt) : item.notBefore;
  if (now.getTime() - sendAt.getTime() > SCHEDULED_LATE_MS) return finish("cancelled", `perdeu a hora (era para ${dueLabel(sendAt.getTime(), now.getTime())})`, "autora");
  const [author] = item.createdBy ? await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.id, item.createdBy)) : [];
  if (!author?.active) return finish("cancelled", "quem agendou não está mais na equipe", "gestao");
  if (meta.cancelIfReply !== false) {
    const [{ last }] = await db.select({ last: max(messages.createdAt) }).from(messages).where(and(eq(messages.contactId, row.contact.id), eq(messages.direction, "in")));
    if (last && last.getTime() > item.createdAt.getTime()) { await closeTask("cancelada"); return finish("cancelled", "a cliente escreveu depois que você agendou", "autora"); }
  }
  try {
    await sendFromCrm(await targetDeal(item.dealId), item.text, author.id);
  } catch (e) {
    return finish("failed", (e instanceof Error ? e.message : String(e)).replace(/^Não foi possível enviar: /, ""), "autora");
  }
  await db.update(outbox).set({ status: "sent", sentAt: now, error: null }).where(eq(outbox.id, item.id));
  await closeTask("concluida");
  await emit("agendada", { dealId: item.dealId });
  return "sent";
}
