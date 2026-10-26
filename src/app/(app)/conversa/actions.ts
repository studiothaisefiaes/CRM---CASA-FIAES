"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { addNote } from "@/server/domain/notes";
import { CALL_OUTCOMES, markIncomingCall, registerOutgoingCall, type CallOutcome, type MarkStatus } from "@/server/domain/manual-calls";
import { cancelScheduled, scheduleMessage, sendScheduledNow } from "@/server/domain/scheduled";
import { createQuickReply, makeQuickReplyUniversal, sendQuickReply, updateQuickReply } from "@/server/domain/quick-replies";
import { can } from "@/lib/permissions";
import { listLibrary, libraryTags, sendLibraryFile, type LibraryItem } from "@/server/domain/library";
import { funcaoLigada } from "@/server/domain/funcoes";
import { waitedBusinessSeconds } from "@/server/domain/deals";
import { resolveWithoutReply, undoResolve } from "@/server/domain/resolve";
import { setConversationStatus } from "@/server/domain/conversation-status";
import { bulkResume, cancelPendingMessages, cancelResume, doneResume, resume, sendResumeNow } from "@/server/domain/retomada";
import { actionableIds, BULK_MAX, bulkResolve } from "@/server/domain/bulk";
import { updateContactProfile, type ContactProfilePatch } from "@/server/domain/contact-profile";
import { CONVERSATION_STATUSES, type ConversationStatus } from "@/lib/conversation-status";
import { deleteForEveryone, hideMessage } from "@/server/domain/delete-message";
import { startConversation } from "@/server/domain/start-conversation";
import { searchPeople, type PersonFound } from "@/server/queries/people-search";
import { startNewConversation } from "@/server/domain/new-client";
import { editSentMessage, reactToMessage, sendCasaLocation, sendContactCard } from "@/server/domain/message-tools";
import { markUnread, setFollowing } from "@/server/domain/follow";
import { forwardInBackground, prepareForward } from "@/server/domain/forward";
import { forwardTargets, type ForwardTarget } from "@/server/queries/forward-targets";
import { UserFacingError } from "@/server/domain/errors";
import { assertCanActOnDeal, assertCanActOnMessage, assertCanActOnOutbox } from "@/server/domain/deal-scope";

/** Ações da conversa do Lote 5 (nota interna, mensagem agendada, resposta pronta com anexo, Resolvido). */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "conversa") });
const uuid = z.string().uuid();

/** Nota interna (a cliente não vê). `mentions`: ids da equipe chamados com @. */
export async function addNoteAction(input: { dealId: string; body: string; mentions: string[]; subject?: string | null; messageId?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(input.dealId));
    const r = await addNote({ dealId: uuid.parse(input.dealId), body: z.string().max(4000).parse(input.body), mentions: z.array(uuid).max(10).parse(input.mentions ?? []),
      subject: z.string().max(400).nullish().parse(input.subject), messageId: uuid.nullish().parse(input.messageId) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { id: r.id } };
  } catch (e) { return fail(e); }
}

/** "Registrar ligação" feita pela Casa pelo celular. Nada vai para a cliente (não passa pelo outbox). Mesma permissão de responder. */
export async function registerCallAction(input: { dealId: string; outcome: CallOutcome; durationMin?: number | null; subject?: string | null; note?: string | null }): Promise<ActionResult<{ messageId: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(input.dealId));
    const r = await registerOutgoingCall({ dealId: uuid.parse(input.dealId), outcome: z.enum(CALL_OUTCOMES as [CallOutcome, ...CallOutcome[]]).parse(input.outcome),
      durationMin: z.number().int().nullish().parse(input.durationMin), subject: z.string().max(400).nullish().parse(input.subject), note: z.string().max(4000).nullish().parse(input.note) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/** "Foi atendida" / "Foi perdida" na ligação recebida sem resultado; "recebida" volta ao que era (Desfazer). */
export async function markCallAction(input: { messageId: string; status: MarkStatus }): Promise<ActionResult<{ previous: MarkStatus }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnMessage(user, uuid.parse(input.messageId));
    const r = await markIncomingCall({ messageId: uuid.parse(input.messageId), status: z.enum(["atendida", "perdida", "recebida"]).parse(input.status) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { previous: r.previous } };
  } catch (e) { return fail(e); }
}

/** Agenda o texto do campo para `at` (ISO). A hora é conferida no servidor (Casa aberta, 5 min a 60 dias). */
export async function scheduleMessageAction(input: { dealId: string; text: string; at: string; cancelIfReply: boolean }): Promise<ActionResult<{ at: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(input.dealId));
    const at = new Date(z.string().min(10).max(40).parse(input.at));
    const r = await scheduleMessage({ dealId: uuid.parse(input.dealId), text: z.string().max(4000).parse(input.text), at, cancelIfReply: z.boolean().parse(input.cancelIfReply) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { at: r.at.toISOString() } };
  } catch (e) { return fail(e); }
}

export async function cancelScheduledAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnOutbox(user, uuid.parse(id));
    await cancelScheduled(uuid.parse(id), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function sendScheduledNowAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnOutbox(user, uuid.parse(id));
    await sendScheduledNow(uuid.parse(id), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Resposta pronta com anexo: o texto (assinado) e depois o arquivo dela. */
export async function sendQuickReplyAction(input: { dealId: string; replyId: string; text: string }): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const dealId = uuid.parse(input.dealId);
    await assertCanActOnDeal(user, dealId);
    const waitedSeconds = await waitedBusinessSeconds(dealId);
    await sendQuickReply(dealId, uuid.parse(input.replyId), z.string().max(4000).parse(input.text), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** A Biblioteca para o clipe da conversa. Exige `biblioteca.enviar`; função desligada = recusa. */
export async function listLibraryAction(input: { tag?: string | null; q?: string | null } = {}): Promise<ActionResult<{ items: LibraryItem[]; tags: string[] }>> {
  try {
    await assertPerm("biblioteca.enviar");
    if (!(await funcaoLigada("biblioteca"))) throw new UserFacingError("Biblioteca está desligada em Configurações › Recursos.");
    const [items, tags] = await Promise.all([listLibrary({ tag: input.tag ?? null, q: input.q ?? null }), libraryTags()]);
    return { ok: true, data: { items, tags } };
  } catch (e) { return fail(e); }
}

/** Manda um arquivo da Biblioteca na hora, pela atendente (mesmo caminho do envio de arquivo). Exige `biblioteca.enviar`. */
export async function sendLibraryFileAction(dealId: string, fileId: string, caption: string | null): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("biblioteca.enviar");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const waitedSeconds = await waitedBusinessSeconds(id);
    await sendLibraryFile(id, uuid.parse(fileId), z.string().max(1000).nullish().parse(caption) ?? null, user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** "Resolvido (não precisa responder)": encerra a espera sem mandar nada. */
export async function resolveAction(dealId: string): Promise<ActionResult<{ resolved: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const r = await resolveWithoutReply(uuid.parse(dealId), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

export async function undoResolveAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    await undoResolve(uuid.parse(dealId), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Status da conversa à mão (seletor do cabeçalho): Aberto, Aguardando ou Resolvido. Devolve o de antes (para o Desfazer). */
export async function setConversationStatusAction(dealId: string, status: ConversationStatus): Promise<ActionResult<{ changed: boolean; before: ConversationStatus }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const r = await setConversationStatus(uuid.parse(dealId), z.enum(CONVERSATION_STATUSES).parse(status), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/* ---------- Retomada (nova organização, 16/10): uma ação só, lembrete ou mensagem programada ---------- */
const resumeInput = z.object({
  dueAt: z.string().min(10).max(40), motivo: z.string().max(120).nullish(), texto: z.string().max(4000).nullish(), cancelIfReply: z.boolean().optional(), assigneeId: uuid.nullish(),
});
type ResumeIn = z.input<typeof resumeInput>;
const toResume = (v: z.output<typeof resumeInput>) => ({ dueAt: new Date(v.dueAt), motivo: v.motivo, texto: v.texto, cancelIfReply: v.cancelIfReply, ...(v.assigneeId !== undefined ? { assigneeId: v.assigneeId } : {}) });

export async function resumeAction(dealId: string, input: ResumeIn): Promise<ActionResult<{ dueAt: string; texto: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const v = resumeInput.parse(input);
    const r = await resume(uuid.parse(dealId), toResume(v), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { dueAt: r.dueAt.toISOString(), texto: !!r.outboxId } };
  } catch (e) { return fail(e); }
}

export async function bulkResumeAction(dealIds: string[], input: ResumeIn): Promise<ActionResult<{ ok: number; failed: number }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const ids = z.array(uuid).min(1).max(BULK_MAX).parse(dealIds);
    const allowed = await actionableIds(ids, user, "open");
    const r = await bulkResume(allowed, toResume(resumeInput.parse(input)), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { ok: r.ok, failed: r.failed.length + (ids.length - allowed.length) } };
  } catch (e) { return fail(e); }
}

export async function doneResumeAction(dealId: string): Promise<ActionResult> {
  try { const user = await assertPerm("atendimento.ver"); await assertCanActOnDeal(user, uuid.parse(dealId)); await doneResume(uuid.parse(dealId), user.id); revalidatePath("/atendimento"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function cancelResumeAction(dealId: string): Promise<ActionResult> {
  try { const user = await assertPerm("atendimento.ver"); await assertCanActOnDeal(user, uuid.parse(dealId)); await cancelResume(uuid.parse(dealId), user.id); revalidatePath("/atendimento"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function sendResumeNowAction(outboxId: string): Promise<ActionResult> {
  try { const user = await assertPerm("atendimento.ver"); await assertCanActOnOutbox(user, uuid.parse(outboxId)); await sendResumeNow(uuid.parse(outboxId), user.id); revalidatePath("/atendimento"); return { ok: true }; } catch (e) { return fail(e); }
}

/** Resolver ou Perdido com mensagem programada: "Cancelar" na pergunta "Manter a mensagem de …?" (P5). */
export async function cancelPendingMessagesAction(dealId: string): Promise<ActionResult<{ cancelled: number }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const cancelled = await cancelPendingMessages(uuid.parse(dealId), user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { cancelled } };
  } catch (e) { return fail(e); }
}

/** "Resolver" em massa (o antigo Encerrar). */
export async function bulkResolveAction(dealIds: string[]): Promise<ActionResult<{ resolved: number; ids: string[]; skipped: number }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const r = await bulkResolve(z.array(uuid).max(BULK_MAX).parse(dealIds), user);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/** "Editar dados" da cliente pela conversa (mesma regra da ficha: grava só o que mudou e audita por campo). */
export async function updateClientDataAction(contactId: string, patch: ContactProfilePatch): Promise<ActionResult<{ changed: string[] }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const r = await updateContactProfile(uuid.parse(contactId), patch, user.id, user.perms);
    revalidatePath("/atendimento"); revalidatePath(`/contatos/${contactId}`);
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/* ---------- Respostas prontas: universal (gestão) ou só minha (qualquer pessoa do atendimento) ---------- */
const replyInput = z.object({ label: z.string().max(80), body: z.string().max(4000), folder: z.string().max(80).nullish() });
const actorOf = (u: { id: string; perms: readonly string[] }) => ({ id: u.id, canShare: can(u.perms, "config.sistema") });
const revalidateReplies = () => { revalidatePath("/atendimento"); revalidatePath("/config/listas"); };

export async function createQuickReplyAction(input: { label: string; body: string; scope: "universal" | "minha"; folder?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = replyInput.parse(input);
    const r = await createQuickReply({ ...v, scope: z.enum(["universal", "minha"]).parse(input.scope) }, actorOf(user));
    revalidateReplies();
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

export async function updateQuickReplyAction(id: string, input: { label: string; body: string; active?: boolean }): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = replyInput.parse(input);
    await updateQuickReply(uuid.parse(id), { label: v.label, body: v.body, active: z.boolean().optional().parse(input.active) }, actorOf(user));
    revalidateReplies();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function makeQuickReplyUniversalAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("config.sistema");
    await makeQuickReplyUniversal(uuid.parse(id), actorOf(user));
    revalidateReplies();
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** "Apagar para todos" (17/10): apaga no WhatsApp da cliente uma mensagem enviada pela Casa. A tela já pediu a confirmação. */
export async function deleteForEveryoneAction(messageId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("mensagem.apagar_todos");
    await assertCanActOnMessage(user, uuid.parse(messageId));
    await deleteForEveryone(uuid.parse(messageId), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** "Apagar só aqui": tira a mensagem da conversa no CRM; o WhatsApp da cliente não muda. */
export async function hideMessageAction(messageId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("mensagem.apagar_todos");
    await assertCanActOnMessage(user, uuid.parse(messageId));
    await hideMessage(uuid.parse(messageId), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/* ---------- Reagir, editar, Como chegar e Mandar contato (Task 12). Cada uma tem permissão própria e função ligável. ---------- */

/** Reage com 👍 ❤️ 🙏 ou 😂; o mesmo emoji de novo (ou null) tira a reação. */
export async function reactAction(messageId: string, emoji: string | null): Promise<ActionResult> {
  try {
    const user = await assertPerm("mensagem.reagir");
    await assertCanActOnMessage(user, uuid.parse(messageId));
    await reactToMessage(uuid.parse(messageId), z.string().max(16).nullable().parse(emoji), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Edita uma mensagem que a própria pessoa enviou pelo CRM, dentro do prazo. */
export async function editMessageAction(messageId: string, text: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("mensagem.editar");
    await assertCanActOnMessage(user, uuid.parse(messageId));
    await editSentMessage(uuid.parse(messageId), z.string().max(4000).parse(text), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** "Como chegar": manda o pino da Casa. */
export async function sendLocationAction(dealId: string): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("mensagem.localizacao");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const waitedSeconds = await waitedBusinessSeconds(id);
    await sendCasaLocation(id, user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** "Mandar contato": cartão com nome e telefone. */
export async function sendContactAction(dealId: string, c: { fullName: string; phone: string }): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("mensagem.contato");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const v = z.object({ fullName: z.string().max(100), phone: z.string().max(30) }).parse(c);
    const waitedSeconds = await waitedBusinessSeconds(id);
    await sendContactCard(id, { fullName: v.fullName, phoneE164: v.phone }, user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/* ---------- Encaminhar (Task 13). Permissão própria; a origem e cada destino têm de estar no escopo de quem encaminha. ---------- */

/** Para quem encaminhar: busca por nome ou telefone, Equipe no topo. */
export async function forwardTargetsAction(q: string, exceptDealId: string | null): Promise<ActionResult<ForwardTarget[]>> {
  try {
    const user = await assertPerm("mensagem.encaminhar");
    return { ok: true, data: await forwardTargets(user, z.string().max(80).parse(q), exceptDealId && uuid.safeParse(exceptDealId).success ? exceptDealId : null) };
  } catch (e) { return fail(e); }
}

/** Destino: uma conversa aberta (id), uma pessoa sem conversa aberta (`contactId`: abre uma) ou um número novo (`phone`: cadastra e abre). */
export type ForwardTo = string | { contactId: string } | { phone: string };
/** O encaminhamento foi aceito: `messages` mensagens vão para `targets` conversas (os envios seguem depois da resposta). */
export type ForwardResult = { messages: number; targets: number };
/**
 * Encaminha uma ou várias mensagens da mesma conversa (selecionar como no WhatsApp, 24/10) para até `max_destinos` conversas.
 * Tudo o que pode recusar o pedido roda ANTES de abrir qualquer conversa nova (pedido recusado não deixa conversa vazia na Fila): a
 * permissão, o escopo de CADA mensagem e, no domínio (`prepareForward`), limites, mesma conversa e o que dá para encaminhar. Depois abre
 * as conversas que faltam, confere o escopo de cada destino e devolve na hora: os envios seguem depois da resposta (`after`), em série e
 * na ordem da conversa em cada destino, e o que não sair vira aviso no sino de quem encaminhou (revisão 24/10: com 12 vídeos para 3
 * conversas o "Para quem?" ficava minutos preso no spinner).
 */
export async function forwardMessagesAction(messageIds: string[], to: ForwardTo[]): Promise<ActionResult<ForwardResult>> {
  try {
    const user = await assertPerm("mensagem.encaminhar");
    const mids = [...new Set(z.array(z.string().uuid()).min(1).max(100).parse(messageIds))];
    const parsed = z.array(z.union([z.string().uuid(), z.object({ contactId: z.string().uuid() }), z.object({ phone: z.string().min(8).max(40) })])).min(1).max(50).parse(to);
    for (const id of mids) await assertCanActOnMessage(user, id);
    const count = new Set(parsed.map((t) => (typeof t === "string" ? t : "contactId" in t ? `c:${t.contactId}` : `p:${t.phone.replace(/\D/g, "")}`))).size;
    const plan = await prepareForward(mids, count);
    // "Encaminhar para outras pessoas" (20/10): quem não tem conversa aberta ganha uma (como o "Nova conversa"); nada sai além do que foi encaminhado.
    const ids: string[] = [];
    for (const t of parsed) {
      if (typeof t === "string") ids.push(t);
      else if ("contactId" in t) ids.push((await startConversation(t.contactId, user.id)).dealId);
      else ids.push((await startNewConversation({ phone: t.phone }, user.id)).dealId);
    }
    const targets = [...new Set(ids)];
    for (const d of targets) await assertCanActOnDeal(user, d);
    after(() => forwardInBackground(plan, targets, user.id));
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { messages: mids.length, targets: targets.length } };
  } catch (e) { return fail(e); }
}

/** Busca da Fila: pessoas pelo nome, telefone ou CPF, inclusive quem não tem conversa aberta (20/10). */
export async function searchPeopleAction(q: string): Promise<ActionResult<PersonFound[]>> {
  try {
    await assertPerm("contatos.ver");
    return { ok: true, data: await searchPeople(z.string().max(80).parse(q)) };
  } catch (e) { return fail(e); }
}

/* ---------- Marcar como não lida e Acompanhar (Task 14). ---------- */

export async function markUnreadAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("conversa.nao_lida");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    await markUnread(id, user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Acompanhar (on) ou deixar de acompanhar (off): a lista é só de quem pediu. */
export async function followAction(dealId: string, on: boolean): Promise<ActionResult> {
  try {
    const user = await assertPerm("conversa.acompanhar");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    await setFollowing(id, user.id, z.boolean().parse(on));
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}
