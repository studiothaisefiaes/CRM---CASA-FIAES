import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { clientPackages, contactNotes, dealEvents, messages, tasks, users } from "../db/schema";
import { scheduledOf } from "../domain/scheduled";
import { conversationStatus, STATUS_LABEL } from "@/lib/conversation-status";
import { todayBahia } from "@/lib/agenda";
import type { EquipeContext } from "./prompt";

/**
 * "A IA entende o sistema" (pedido do dono, 16/10): a situação da conversa na equipe, ENXUTA (~150 tokens no máximo):
 * status, com quem está, transferência recente (e a nota de quem passou), quem pede a sugestão, retomada pendente, pacote ativo e
 * até 2 notas internas recentes. Só primeiros nomes e textos curtos; o texto passa por `redact` em prompt.ts.
 */
export const TRANSFER_DAYS = 3;
export const NOTES_DAYS = 30;
const DAY = 86_400_000;
const OWNER_EVENTS = ["assumiu", "responsavel_alterado", "distribuido", "devolvido_a_fila"];

type DealInfo = { id: string; contactId: string; ownerId: string | null; awaitingReplySince: Date | null; conversationArchivedAt: Date | null };

const nameOf = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  return new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list))).map((u) => [u.id, u.name]));
};

export async function loadEquipeContext(d: DealInfo, requesterId: string | null | undefined, now: Date): Promise<EquipeContext> {
  const since = new Date(now.getTime() - TRANSFER_DAYS * DAY);
  const today = todayBahia(now);
  const [[ev], notes, [task], scheduled, [pkg], spoke] = await Promise.all([
    // A última troca de dona (Transferir, atribuir em massa); assumir para si, distribuir e devolver à fila não são transferência.
    db.select({ type: dealEvents.type, payload: dealEvents.payload, userId: dealEvents.userId, at: dealEvents.createdAt }).from(dealEvents)
      .where(and(eq(dealEvents.dealId, d.id), inArray(dealEvents.type, OWNER_EVENTS), gte(dealEvents.createdAt, since))).orderBy(desc(dealEvents.createdAt)).limit(1),
    db.select({ body: contactNotes.body, authorId: contactNotes.authorId, at: contactNotes.createdAt }).from(contactNotes)
      .where(and(eq(contactNotes.contactId, d.contactId), gte(contactNotes.createdAt, new Date(now.getTime() - NOTES_DAYS * DAY)))).orderBy(desc(contactNotes.createdAt)).limit(3),
    db.select({ title: tasks.title, dueAt: tasks.dueAt }).from(tasks).where(and(eq(tasks.dealId, d.id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1),
    scheduledOf(d.contactId),
    db.select({ name: clientPackages.packageName, total: clientPackages.totalSessions, used: clientPackages.usedSessions }).from(clientPackages)
      .where(and(eq(clientPackages.contactId, d.contactId), isNull(clientPackages.cancelledAt), lt(clientPackages.usedSessions, clientPackages.totalSessions),
        or(isNull(clientPackages.validUntil), gte(clientPackages.validUntil, today))))
      .orderBy(desc(clientPackages.purchasedOn)).limit(1),
    requesterId
      ? db.select({ x: sql<number>`1` }).from(messages).where(and(eq(messages.dealId, d.id), eq(messages.sentByUserId, requesterId))).limit(1)
      : Promise.resolve([] as { x: number }[]),
  ]);

  let transfer: { de: string | null; para: string | null; at: Date; byId: string | null } | null = null;
  if (ev?.type === "responsavel_alterado") {
    const campo = (ev.payload as { campos?: { campo: string; de: unknown; para: unknown }[] }).campos?.find((c) => c.campo === "ownerId");
    const para = typeof campo?.para === "string" ? campo.para : null;
    // Quem passou para si mesma não é transferência.
    if (para && ev.userId && ev.userId !== para) transfer = { de: typeof campo?.de === "string" ? campo.de : ev.userId, para, at: ev.at, byId: ev.userId };
  }
  const names = await nameOf([d.ownerId, requesterId, transfer?.de, transfer?.para]);
  // A nota de quem passou, escrita até 15 min antes/depois da transferência.
  const tNote = transfer ? notes.find((n) => n.authorId === transfer!.byId && Math.abs(n.at.getTime() - transfer!.at.getTime()) <= 15 * 60_000) : undefined;
  const msg = scheduled[0];
  return {
    status: STATUS_LABEL[conversationStatus({ archivedAt: d.conversationArchivedAt, awaitingSince: d.awaitingReplySince })],
    com: d.ownerId ? names.get(d.ownerId) ?? null : null,
    transfer: transfer ? { de: names.get(transfer.de ?? "") ?? null, para: names.get(transfer.para ?? "") ?? null, at: transfer.at, nota: tNote?.body ?? null } : null,
    quemPede: requesterId && names.get(requesterId) ? { nome: names.get(requesterId)!, jaFalou: spoke.length > 0 } : null,
    retomada: msg ? { at: msg.at, texto: `mensagem programada: ${msg.text}` } : task ? { at: task.dueAt, texto: task.title } : null,
    pacote: pkg ? `${pkg.name}, ${pkg.total - pkg.used} de ${pkg.total} sessões restantes` : null,
    notas: notes.filter((n) => n !== tNote).slice(0, 2).reverse().map((n) => n.body),
  };
}
