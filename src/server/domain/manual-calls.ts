import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, deals, messages } from "../db/schema";
import { callLabel, type CallInfo, type CallStatus } from "@/lib/calls";
import { recordOutbound } from "./deals";
import { addNote, NOTE_MAX, NOTE_SUBJECT_MAX } from "./notes";
import { emit } from "./events";
import { waitAlertsOf } from "./resolve";
import { UserFacingError } from "./errors";

/** Resultado da ligação feita pela Casa, como a equipe conta no diálogo. */
export type CallOutcome = "atendeu" | "nao_atendeu" | "ocupado";
export const CALL_OUTCOMES: readonly CallOutcome[] = ["atendeu", "nao_atendeu", "ocupado"];
export const CALL_MAX_MIN = 600;

/**
 * "Registrar ligação": a ligação que a Casa fez pelo celular (o WhatsApp não manda evento nenhum dela) vira um item da conversa,
 * kind "call" direction "out", com a autora = quem registrou. NUNCA passa pelo outbox nem pela Evolution: nada vai para a cliente.
 * - atendeu: conta como contato da Casa (a mesma regra da resposta: `recordOutbound` sem texto) e a anotação "o que foi falado" vai junto;
 * - não atendeu / caixa postal / ocupado: só fica registrado; a cliente continua esperando (não é resposta).
 */
export async function registerOutgoingCall(input: { dealId: string; outcome: CallOutcome; durationMin?: number | null; subject?: string | null; note?: string | null }, userId: string, now = new Date()): Promise<{ messageId: string }> {
  if (!CALL_OUTCOMES.includes(input.outcome)) throw new UserFacingError("Escolha como foi a ligação.");
  const answered = input.outcome === "atendeu";
  const note = input.note?.trim() || "";
  const subject = input.subject?.trim() || null;
  const min = input.durationMin ?? null;
  if (min !== null && (!Number.isInteger(min) || min < 1 || min > CALL_MAX_MIN)) throw new UserFacingError(`Duração em minutos inteiros, de 1 a ${CALL_MAX_MIN} (ou deixe em branco).`);
  if (answered && !note) throw new UserFacingError("Escreva o que foi falado na ligação.");
  if (note.length > NOTE_MAX) throw new UserFacingError(`Anotação muito longa (máximo ${NOTE_MAX.toLocaleString("pt-BR")} caracteres).`);
  if (subject && subject.length > NOTE_SUBJECT_MAX) throw new UserFacingError(`Assunto muito longo (máximo ${NOTE_SUBJECT_MAX} caracteres).`);
  const [deal] = await db.select({ id: deals.id, contactId: deals.contactId, channelId: deals.channelId, archivedAt: deals.archivedAt }).from(deals).where(eq(deals.id, input.dealId));
  if (!deal || deal.archivedAt) throw new UserFacingError("Essa conversa não existe mais.");

  const info: CallInfo = { video: false, status: answered ? "atendida" : "perdida", durationSecs: answered && min ? min * 60 : null, manual: true,
    ...(input.outcome === "ocupado" ? { busy: true } : {}) };
  const body = callLabel(info, "out");
  let messageId: string;
  if (answered) {
    const r = await recordOutbound({ dealId: deal.id, channelId: deal.channelId, kind: "call", body, userId, call: info, at: now });
    if (!("messageId" in r) || !r.messageId) throw new UserFacingError("Não deu para registrar a ligação. Tente de novo.");
    messageId = r.messageId;
  } else {
    // Não atendida: entra na conversa e na Fila, sem mexer na espera, na etapa nem na dona.
    const [m] = await db.insert(messages).values({ dealId: deal.id, contactId: deal.contactId, channelId: deal.channelId, direction: "out", kind: "call", body,
      status: "sent", sentByUserId: userId, fromPhone: false, call: info, createdAt: now }).returning({ id: messages.id });
    messageId = m.id;
    await emit("mensagem_enviada", { dealId: deal.id });
  }
  if (note) await addNote({ dealId: deal.id, body: note, subject, messageId }, userId, now);
  await db.insert(auditLog).values({ userId, action: "registrou_ligacao", entity: "deal", entityId: deal.id,
    data: { messageId, resultado: input.outcome, duracaoMin: min, comNota: !!note } });
  return { messageId };
}

/** O que a equipe pode marcar numa ligação recebida sem resultado; "recebida" = voltar a "não sei" (Desfazer). */
export type MarkStatus = Extract<CallStatus, "atendida" | "perdida" | "recebida">;

/**
 * "Foi atendida" / "Foi perdida" na ligação recebida que o WhatsApp deixou sem resultado ("recebida": atendida no celular não avisa o CRM).
 * - atendida: a cliente deixa de esperar, se a ligação é o que ela fez por último (mensagem escrita depois continua esperando);
 * - perdida: ela continua esperando retorno;
 * - trocar de volta (ou desfazer) devolve a espera que a "atendida" tirou, se ninguém da Casa escreveu depois.
 * Só vale para ligação recebida que chegou como "recebida" (ou já marcada à mão): o resultado do WhatsApp não se troca.
 */
export async function markIncomingCall(input: { messageId: string; status: MarkStatus }, userId: string, now = new Date()): Promise<{ changed: boolean; previous: MarkStatus; status: MarkStatus; dealId: string | null }> {
  if (!["atendida", "perdida", "recebida"].includes(input.status)) throw new UserFacingError("Escolha se a ligação foi atendida ou perdida.");
  const r = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(messages).where(eq(messages.id, input.messageId)).for("update");
    if (!m || m.kind !== "call" || m.direction !== "in") throw new UserFacingError("Essa ligação não existe mais.");
    const call: CallInfo = m.call ?? { video: false, status: "recebida" };
    if (call.status !== "recebida" && !call.marked) throw new UserFacingError("Essa ligação já veio com o resultado do WhatsApp.");
    const previous = call.status as MarkStatus;
    if (previous === input.status) return { changed: false, previous, status: input.status, dealId: m.dealId };
    const [d] = m.dealId ? await tx.select().from(deals).where(eq(deals.id, m.dealId)).for("update") : [];
    let prevAwaitingSince: string | null = null;
    let awaiting: Date | null | undefined; // undefined: não mexe
    // Saindo de "atendida" marcada à mão: a espera que ela tirou volta (se a Casa não escreveu depois e ninguém abriu outra).
    if (d && previous === "atendida" && call.marked?.prevAwaitingSince && !d.awaitingReplySince && !(d.lastOutboundAt && d.lastOutboundAt > new Date(call.marked.at)))
      awaiting = new Date(call.marked.prevAwaitingSince);
    // Foi atendida: falou com a Casa. Tira a espera, a menos que ela tenha escrito depois da ligação.
    if (d && input.status === "atendida" && d.awaitingReplySince && !(d.lastInboundAt && d.lastInboundAt > m.createdAt)) {
      prevAwaitingSince = d.awaitingReplySince.toISOString();
      awaiting = null;
      await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` }).where(waitAlertsOf(d.id));
    }
    if (d && awaiting !== undefined) await tx.update(deals).set({ awaitingReplySince: awaiting }).where(eq(deals.id, d.id));
    const next: CallInfo = { ...call, status: input.status, marked: input.status === "recebida" ? null : { by: userId, at: now.toISOString(), prevAwaitingSince } };
    await tx.update(messages).set({ call: next, body: callLabel(next, "in") }).where(eq(messages.id, m.id));
    await tx.insert(auditLog).values({ userId, action: "marcou_ligacao", entity: "message", entityId: m.id, data: { dealId: m.dealId, de: previous, para: input.status } });
    return { changed: true, previous, status: input.status, dealId: m.dealId };
  });
  if (r.changed && r.dealId) await emit("mensagem_atualizada", { dealId: r.dealId });
  return r;
}
