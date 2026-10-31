"use server";
import { markRescheduled } from "@/server/domain/agenda/remarcou";
import { revalidatePath } from "next/cache";
import { can, canSeeDealMoney } from "@/lib/permissions";
import { touchesMoney } from "@/lib/money-fields";
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { SALE_VALUE_REQUIRED } from "@/lib/money";
import { assertAnyPerm, assertPerm, assertUser } from "@/server/auth/session";
import { moveDeal, ReopenConflict, waitedBusinessSeconds } from "@/server/domain/deals";
import { claimDeal, transferDeal } from "@/server/domain/assign";
import { passToTeam } from "@/server/domain/teams";
import { assertDirectMove } from "@/server/domain/stage-move";
import { BULK_MAX, bulkArchive, bulkAssign, bulkMove, bulkRestore } from "@/server/domain/bulk";
import { completeTask, setNextAction } from "@/server/domain/tasks";
import { updateDeal, createManualLead, closeSale, scheduleDeal, loseDeal, markAttendance, undoMissedAttendance, UserFacingError, type DealPatch, type ScheduleConflict } from "@/server/domain/updates";
import { MAX_MEDIA_BYTES, sendFromCrm, sendMediaFromCrm } from "@/server/domain/send";
import { setTeamContact } from "@/server/domain/team-contact";
import { startNewConversation } from "@/server/domain/new-client";
import { setContactKind } from "@/server/domain/contact-kind";
import { CONTACT_KINDS, type ContactKind } from "@/lib/contact-kind";
import { db } from "@/server/db";
import { userErrorMessage } from "@/server/user-error";
import { alerts, deals, leadSources, tasks } from "@/server/db/schema";
import { addTag, removeTag } from "@/server/domain/tags";
import { archiveConversation, unarchiveConversation } from "@/server/domain/conversation-archive";
import { markProposalSent, markWaitingForClient } from "@/server/domain/funnel";
import { emit } from "@/server/domain/events";
import { resolveAlerts } from "@/server/domain/alert-actions";
import { assertCanActOnDeal } from "@/server/domain/deal-scope";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
/** Erro para a tela: texto do domínio ou da regra; SQL, rede e bugs vão para o log e viram "Não deu certo. Tente de novo." */
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "funil") });

/** Mensagens que o domínio escreve em texto fixo (pt-BR) e podem chegar à tela. Qualquer outro erro vira o texto da ação. */
const KNOWN_ERRORS = new Set(["Sua sessão expirou. Entre de novo.", "Só a gestão pode fazer isso.", "Conversa não encontrada", "Conversa arquivada não pode fechar venda", "Serviço não encontrado"]);
/** Erro para a tela: texto fixo. Nunca o `message` cru de um erro qualquer (SQL, rede) nem o JSON do zod. */
const safe = (e: unknown, fallback: string): { ok: false; error: string } => {
  if (e instanceof ReopenConflict || e instanceof UserFacingError || (e instanceof Error && KNOWN_ERRORS.has(e.message))) return { ok: false, error: (e as Error).message };
  console.error("[funil]", fallback, e);
  return { ok: false, error: fallback };
};
const revalidateLead = () => { revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/"); };

/**
 * Mover de etapa (Quadro e painel). Agendado, Fechado e Perdido não passam por aqui: pedem data, valor e pagamento ou motivo, então
 * têm a ação própria (`scheduleAction`, `closeSaleAction`, `loseAction`). Recusa com "Use a ação própria".
 */
export async function moveDealAction(dealId: string, stageKey: string): Promise<ActionResult> {
  try {
    const user = await assertAnyPerm("atendimento.ver", "quadro.ver");
    await assertCanActOnDeal(user, z.string().uuid().parse(dealId));
    const key = z.string().min(1).max(40).parse(stageKey);
    await assertDirectMove(key);
    await moveDeal(dealId, key, user.id, "manual");
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível mudar a etapa. Tente de novo."); }
}

export async function updateDealAction(dealId: string, patch: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    if (patch.ownerId !== undefined && !can(user.perms, "atendimento.transferir")) throw new UserFacingError("Você não tem permissão para trocar o responsável pela conversa.");
    if (touchesMoney(patch as Record<string, unknown>) && !canSeeDealMoney(user.perms)) throw new UserFacingError("Você não tem permissão para mexer em valores.");
    await assertCanActOnDeal(user, z.string().uuid().parse(dealId));
    await updateDeal(z.string().uuid().parse(dealId), patch, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Espera em horário de expediente (igual ao SLA e aos relatórios), não em tempo corrido. */
const waited = (id: string) => waitedBusinessSeconds(id);

export async function sendMessageAction(dealId: string, text: string, quoteMessageId?: string | null): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = z.string().uuid().parse(dealId);
    const quote = z.string().uuid().nullish().parse(quoteMessageId);
    await assertCanActOnDeal(user, id);
    const waitedSeconds = await waited(id);
    await sendFromCrm(id, text, user.id, { quoteMessageId: quote });
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** Foto, PDF ou áudio (FormData: dealId, file, caption?, quoteMessageId?). Até 16 MB; o tipo é conferido pelos bytes no servidor. */
export async function sendMediaAction(form: FormData): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = z.string().uuid().parse(form.get("dealId"));
    await assertCanActOnDeal(user, id);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Escolha um arquivo para enviar.");
    if (file.size > MAX_MEDIA_BYTES) throw new Error("O arquivo passa de 16 MB. Escolha um menor.");
    const caption = z.string().max(1000, "Legenda muito longa (máximo 1.000 caracteres).").nullish().parse(form.get("caption"));
    const quote = z.string().uuid().nullish().parse(form.get("quoteMessageId") || null);
    const waitedSeconds = await waited(id);
    await sendMediaFromCrm(id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, caption ?? null, user.id, { quoteMessageId: quote });
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

export async function createLeadAction(form: { phone: string; name?: string }): Promise<ActionResult<{ dealId: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const dealId = await createManualLead(form, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true, data: { dealId } };
  } catch (e) { return fail(e); }
}

export async function markAlertsReadAction(ids?: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const now = new Date();
    const mine = can(user.perms, "alertas.escalada") ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id);
    const valid = z.array(z.string().uuid()).max(500).parse(ids ?? []);
    await db.update(alerts).set({ readAt: now }).where(and(mine, isNull(alerts.readAt), valid.length ? inArray(alerts.id, valid) : undefined));
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** "Resolver" no sino: a pessoa já cuidou (ver `resolveAlerts`). */
export async function resolveAlertsAction(ids: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const valid = z.array(z.string().uuid()).min(1).max(100).parse(ids);
    await resolveAlerts(user, valid);
    await emit("alerta", {});
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---- Painel do cliente: assumir, agendar, fechar venda, perdido, "não é cliente" ----
const uuid = z.string().uuid();

/** "Assumir": a pessoa logada passa a ser a responsável. */
export async function claimAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    await claimDeal(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível assumir a conversa. Tente de novo."); }
}

/** "Transferir para…": quem pode transferir passa o lead para outra pessoa (auditado como troca de responsável) e ela é avisada. */
export async function transferAction(dealId: string, toUserId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.transferir");
    const id = uuid.parse(dealId), to = uuid.parse(toUserId);
    await assertCanActOnDeal(user, id);
    await transferDeal(id, to, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível transferir a conversa. Tente de novo."); }
}

/** "Passar para setor": a conversa vai para quem do setor está Disponível (ou fica sem dona, no setor, e a gestão é avisada). */
export async function passToTeamAction(dealId: string, teamId: string): Promise<ActionResult<{ ownerId: string | null }>> {
  try {
    const user = await assertPerm("atendimento.setor");
    const id = uuid.parse(dealId), team = uuid.parse(teamId);
    await assertCanActOnDeal(user, id);
    const r = await passToTeam(id, team, user.id);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível passar a conversa para o setor. Tente de novo."); }
}

const scheduleSchema = z.object({ dealId: uuid, scheduledAt: z.string().datetime({ offset: true }), serviceId: uuid.nullable().optional(), professionalId: uuid.nullable().optional() });
/** Agendar: dia e hora, e o serviço e a profissional (opcionais). Devolve os horários da mesma profissional a menos de 1 hora, para avisar. */
export async function scheduleAction(dealId: string, scheduledAt: string, extra: { serviceId?: string | null; professionalId?: string | null } = {}): Promise<ActionResult<{ conflicts: ScheduleConflict[] }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const input = scheduleSchema.safeParse({ dealId, scheduledAt, ...extra });
    if (!input.success) return { ok: false, error: "Escolha a data e o horário." };
    await assertCanActOnDeal(user, input.data.dealId);
    const r = await scheduleDeal(input.data.dealId, input.data.scheduledAt, user.id, new Date(), { serviceId: input.data.serviceId, professionalId: input.data.professionalId });
    revalidateLead();
    revalidatePath("/agenda");
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível agendar. Tente de novo."); }
}

const loseSchema = z.object({ dealId: uuid, reasonId: z.union([uuid, z.literal("outro")]), recontactAt: z.string().datetime({ offset: true }).nullable(), detail: z.string().max(400).nullish() });
/** Perdido: o motivo é obrigatório e tem de ser da lista de motivos de perda. "Retomar contato em" é opcional. Dado e etapa numa transação só. */
export async function loseAction(dealId: string, reasonId: string, recontactAt: string | null, detail?: string | null): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const input = loseSchema.safeParse({ dealId, reasonId, recontactAt, detail });
    if (!input.success) return { ok: false, error: "Escolha o motivo da perda." };
    await assertCanActOnDeal(user, input.data.dealId);
    await loseDeal(input.data.dealId, input.data.reasonId, input.data.recontactAt, user.id, new Date(), input.data.detail);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível marcar como perdido. Tente de novo."); }
}

const closeSaleInput = z.object({
  serviceId: uuid,
  valueCents: z.number().int().min(1).max(1_000_000_000),
  paymentMethod: z.enum(["pix", "cartao", "boleto", "dinheiro"]),
  paidNow: z.boolean(),
});
/** Fechar venda numa transação só. `alreadyClosed`: outra pessoa já tinha fechado (nada foi duplicado). */
export async function closeSaleAction(dealId: string, input: z.input<typeof closeSaleInput>): Promise<ActionResult<{ alreadyClosed: boolean }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const parsed = closeSaleInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: !(Number(input?.valueCents) >= 1) ? SALE_VALUE_REQUIRED : "Confira o serviço, o valor e a forma de pagamento." };
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const { alreadyClosed } = await closeSale(uuid.parse(dealId), parsed.data, user.id);
    revalidateLead();
    return { ok: true, data: { alreadyClosed } };
  } catch (e) { return safe(e, "Não foi possível fechar a venda. Tente de novo."); }
}

const ids = z.array(uuid).min(1, "Escolha pelo menos uma conversa.").max(BULK_MAX, `Escolha no máximo ${BULK_MAX} de cada vez.`);
/**
 * "Não é cliente" (um ou vários, até 100): sai da Fila, do Quadro e dos relatórios; nada é apagado. `ids` é o que o Desfazer restaura.
 * Um lead só ou vários: sem "Ver conversas de todas", só os próprios e os sem dono (um só: recusa com o texto; vários: pula os outros). M1, 17/10.
 */
export async function archiveAction(dealIds: string[]): Promise<ActionResult<{ archived: number; ids: string[]; skipped: number }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const list = ids.parse(dealIds);
    if (list.length === 1) await assertCanActOnDeal(user, list[0]);
    const r = await bulkArchive(list, user, { scoped: list.length > 1 });
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível arquivar. Tente de novo."); }
}

export async function restoreAction(dealIds: string[]): Promise<ActionResult<{ restored: number; conflicts: string[]; skipped: number }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const list = ids.parse(dealIds);
    if (list.length === 1) await assertCanActOnDeal(user, list[0]);
    const r = await bulkRestore(list, user, { scoped: list.length > 1 });
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível desfazer. Tente de novo."); }
}

/** "Atribuir a…" em massa: só a gestão. */
export async function bulkAssignAction(dealIds: string[], ownerId: string): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  try {
    const user = await assertPerm("atendimento.transferir");
    const r = await bulkAssign(ids.parse(dealIds), uuid.parse(ownerId), user);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível atribuir. Tente de novo."); }
}

/** "Mover etapa" em massa: só etapas que não pedem diálogo (o servidor confere). */
export async function bulkMoveAction(dealIds: string[], stageKey: string): Promise<ActionResult<{ moved: number; skipped: number }>> {
  try {
    const user = await assertAnyPerm("atendimento.ver", "quadro.ver");
    const r = await bulkMove(ids.parse(dealIds), z.string().min(1).max(40).parse(stageKey), user);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível mudar a etapa. Tente de novo."); }
}

// ---- Próxima ação, comparecimento e "Como conheceu?" ----
const nextActionInput = z.object({
  dealId: uuid,
  title: z.string().trim().min(1, "Escreva o que precisa ser feito.").max(120, "Resuma em até 120 caracteres."),
  dueAt: z.string().datetime({ offset: true, message: "Escolha a data e a hora." }),
  assigneeId: uuid.nullable(),
});
/** Define a próxima ação do lead (uma por lead: a anterior é cancelada e fica no histórico). Mesmo escopo das listas (M1, 17/10). */
export async function createNextActionAction(input: z.input<typeof nextActionInput>): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = nextActionInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Confira os dados." };
    await assertCanActOnDeal(user, v.data.dealId);
    await setNextAction(v.data.dealId, { title: v.data.title, dueAt: new Date(v.data.dueAt), assigneeId: v.data.assigneeId }, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível salvar o combinado. Tente de novo."); }
}

const waitInput = z.object({
  dealId: uuid,
  title: z.string().trim().max(120, "Resuma em até 120 caracteres.").optional(),
  dueAt: z.string().datetime({ offset: true, message: "Escolha a data e a hora." }).nullable(),
  assigneeId: uuid.nullable(),
});
/** "Marcar como aguardando cliente" (e "Retomar depois"): com data, ou automático (tentativas D+1, D+3, D+7). Nunca manda mensagem. */
export async function waitForClientAction(input: z.input<typeof waitInput>): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = waitInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Confira os dados." };
    await assertCanActOnDeal(user, v.data.dealId);
    const r = await markWaitingForClient(v.data.dealId, { resumeAt: v.data.dueAt ? new Date(v.data.dueAt) : null, title: v.data.title || null, assigneeId: v.data.assigneeId }, user.id);
    revalidateLead();
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível marcar como aguardando. Tente de novo."); }
}

/** "Enviei orçamento": Orçamento enviado, retomada em 2 dias se ela não responder. */
export async function proposalSentAction(dealId: string): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const r = await markProposalSent(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível registrar o orçamento. Tente de novo."); }
}

/** Concluir a tarefa com um toque. Repetir não duplica (idempotente). */
export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, uuid.parse(taskId)));
    if (!t) return { ok: false, error: "Essa tarefa não existe mais." };
    await completeTask(taskId, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível concluir. Tente de novo."); }
}

/** "Compareceu" / "Faltou". Quem faltou ganha a próxima ação "Remarcar". */
export async function setAttendanceAction(dealId: string, status: "compareceu" | "faltou"): Promise<ActionResult<{ changed: boolean; remarcar: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const r = await markAttendance(id, z.enum(["compareceu", "faltou"]).parse(status), user.id);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível registrar. Tente de novo."); }
}

/** "Remarcou" no "Ela veio?" (Cati 30/10): o horário vencido sai sem contar falta. `temNovo`: ela já tem outro horário na agenda. */
export async function setRescheduledAction(dealId: string): Promise<ActionResult<{ temNovo: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const r = await markRescheduled(id, user.id);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível registrar. Tente de novo."); }
}

/** Desfazer o Faltou (QA r58, M-2): a conversa volta como estava antes da falta. */
export async function undoMissedAttendanceAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    await undoMissedAttendance(id, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não deu para desfazer. Tente de novo."); }
}

const originInput = z.union([
  z.object({ dealId: uuid, sourceId: uuid }),
  z.object({ dealId: uuid, origin: z.string().trim().min(1, "Escreva como a cliente conheceu a Casa.").max(40, "Use até 40 caracteres.") }),
]);
/** "Como conheceu?": grava a origem do lead (de uma origem cadastrada ou em texto livre), com a auditoria de/para. */
export async function setOriginAction(input: z.input<typeof originInput>): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = originInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Escolha uma opção." };
    await assertCanActOnDeal(user, v.data.dealId);
    if ("sourceId" in v.data) {
      const [src] = await db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.id, v.data.sourceId));
      if (!src) return { ok: false, error: "Essa origem não existe mais." };
      await updateDeal(v.data.dealId, { sourceId: v.data.sourceId }, user.id);
    } else await updateDeal(v.data.dealId, { origin: v.data.origin }, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível salvar a origem. Tente de novo."); }
}

/** Etiqueta na cliente da conversa: escreve o nome (cria se não existir) ou escolhe uma das sugestões. Quem tem a conversa no escopo (M1, 17/10). */
async function contactOfDeal(dealId: string) {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, uuid.parse(dealId)));
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  return d.contactId;
}
export async function addTagAction(dealId: string, name: string): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    const tag = await addTag(await contactOfDeal(dealId), z.string().max(200).parse(name), user.id);
    revalidateLead();
    await emit("lead_atualizado", { dealId });
    return { ok: true, data: tag };
  } catch (e) { return safe(e, "Não foi possível pôr a etiqueta. Tente de novo."); }
}
export async function removeTagAction(dealId: string, tagId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    await removeTag(await contactOfDeal(dealId), uuid.parse(tagId), user.id);
    revalidateLead();
    await emit("lead_atualizado", { dealId });
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível tirar a etiqueta. Tente de novo."); }
}

/** Arquivar conversa: atendimento terminado, sai da Fila; volta sozinha quando a cliente ou a Casa escreve. Desarquivar: volta já. */
export async function archiveConversationAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    await archiveConversation(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível arquivar. Tente de novo."); }
}
export async function unarchiveConversationAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(dealId));
    await unarchiveConversation(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível desarquivar. Tente de novo."); }
}

/**
 * "É da equipe" / "Não é da equipe" (menu da conversa e ficha): número de funcionária. A conversa vai para Filtros › Equipe e sai do funil e das métricas.
 * Mesma permissão do "Não é cliente".
 */
export async function setTeamContactAction(contactId: string, isTeam: boolean): Promise<ActionResult<{ dealId: string | null }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const id = z.string().uuid().parse(contactId);
    const r = await setTeamContact(id, z.boolean().parse(isTeam), user.id);
    revalidatePath(`/contatos/${id}`); revalidatePath("/contatos"); revalidatePath("/atendimento");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/**
 * "Marcar como…" (botão direito ou toque longo na Fila, ⋯ da conversa): Cliente, Equipe, Fornecedor ou Spam. Fornecedor e Spam resolvem a conversa na hora.
 * Mesma permissão do antigo "Não é cliente". Devolve o tipo anterior (para o Desfazer).
 */
export async function setContactKindAction(contactId: string, kind: ContactKind): Promise<ActionResult<{ before: ContactKind; changed: boolean; dealId: string | null; resolved: boolean }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const id = uuid.parse(contactId);
    const r = await setContactKind(id, z.enum(CONTACT_KINDS).parse(kind), user.id);
    revalidatePath(`/contatos/${id}`); revalidatePath("/contatos"); revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

/** "Nova conversa" (Atendimento): acha ou cadastra o contato pelo telefone e abre a conversa pronta para escrever. Não envia nada. */
export async function newConversationAction(input: { phone: string; name?: string }): Promise<ActionResult<{ dealId: string; created: boolean; newContact: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const r = await startNewConversation({ phone: z.string().max(40).parse(input.phone), name: z.string().max(120).optional().parse(input.name) }, user.id);
    revalidatePath("/atendimento"); revalidatePath("/contatos");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}
