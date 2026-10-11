"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { SALE_VALUE_REQUIRED } from "@/lib/money";
import { assertUser } from "@/server/auth/session";
import { moveDeal, ReopenConflict, waitedBusinessSeconds } from "@/server/domain/deals";
import { claimDeal } from "@/server/domain/assign";
import { assertDirectMove } from "@/server/domain/stage-move";
import { BULK_MAX, bulkArchive, bulkAssign, bulkMove, bulkRestore } from "@/server/domain/bulk";
import { completeTask, setNextAction } from "@/server/domain/tasks";
import { updateDeal, createManualLead, closeSale, scheduleDeal, loseDeal, markAttendance, UserFacingError, type DealPatch } from "@/server/domain/updates";
import { MAX_MEDIA_BYTES, markConversationRead, sendFromCrm, sendMediaFromCrm } from "@/server/domain/send";
import { db } from "@/server/db";
import { userErrorMessage } from "@/server/user-error";
import { alerts, leadSources, tasks, users } from "@/server/db/schema";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
/** Erro para a tela: texto do domínio ou da regra; SQL, rede e bugs vão para o log e viram "Não deu certo. Tente de novo." */
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "funil") });

/** Mensagens que o domínio escreve em texto fixo (pt-BR) e podem chegar à tela. Qualquer outro erro vira o texto da ação. */
const KNOWN_ERRORS = new Set(["Sua sessão expirou. Entre de novo.", "Só a gestão pode fazer isso.", "Lead não encontrado", "Lead arquivado não pode fechar venda", "Serviço não encontrado"]);
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
    const user = await assertUser();
    z.string().uuid().parse(dealId);
    const key = z.string().min(1).max(40).parse(stageKey);
    await assertDirectMove(key);
    await moveDeal(dealId, key, user.id, "manual");
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível mudar a etapa. Tente de novo."); }
}

export async function updateDealAction(dealId: string, patch: DealPatch): Promise<ActionResult> {
  try {
    const user = await assertUser();
    if (patch.ownerId !== undefined && user.role !== "gestor") throw new Error("Só a gestão troca o responsável pelo lead.");
    await updateDeal(z.string().uuid().parse(dealId), patch, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Espera em horário de expediente (igual ao SLA e aos relatórios), não em tempo corrido. */
const waited = (id: string) => waitedBusinessSeconds(id);

export async function sendMessageAction(dealId: string, text: string, quoteMessageId?: string | null): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertUser();
    const id = z.string().uuid().parse(dealId);
    const quote = z.string().uuid().nullish().parse(quoteMessageId);
    const waitedSeconds = await waited(id);
    await sendFromCrm(id, text, user.id, { quoteMessageId: quote });
    revalidatePath("/funil"); revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}

/** Foto, PDF ou áudio (FormData: dealId, file, caption?, quoteMessageId?). Até 16 MB; o tipo é conferido pelos bytes no servidor. */
export async function sendMediaAction(form: FormData): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertUser();
    const id = z.string().uuid().parse(form.get("dealId"));
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

/** Chamada ao abrir a conversa. Não espera a Evolution: o visto azul nunca atrasa nem derruba a tela. */
export async function markConversationReadAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    void markConversationRead(z.string().uuid().parse(dealId), user.id);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function createLeadAction(form: { phone: string; name?: string }): Promise<ActionResult<{ dealId: string }>> {
  try {
    const user = await assertUser();
    const dealId = await createManualLead(form, user.id);
    revalidatePath("/funil"); revalidatePath("/atendimento");
    return { ok: true, data: { dealId } };
  } catch (e) { return fail(e); }
}

export async function markAlertsReadAction(ids?: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const now = new Date();
    const mine = user.role === "gestor" ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id);
    const valid = z.array(z.string().uuid()).max(500).parse(ids ?? []);
    await db.update(alerts).set({ readAt: now }).where(and(mine, isNull(alerts.readAt), valid.length ? inArray(alerts.id, valid) : undefined));
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---- Painel do cliente: assumir, agendar, fechar venda, perdido, "não é cliente" ----
const uuid = z.string().uuid();

/** "Assumir": a pessoa logada passa a ser a responsável. */
export async function claimAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    await claimDeal(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível assumir o lead. Tente de novo."); }
}

/** "Transferir para…": só a gestão passa o lead para outra pessoa (auditado como troca de responsável). */
export async function transferAction(dealId: string, toUserId: string): Promise<ActionResult> {
  try {
    const user = await assertUser("gestor");
    const id = uuid.parse(dealId), to = uuid.parse(toUserId);
    const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, to), eq(users.active, true)));
    if (!target) return { ok: false, error: "Essa pessoa não está mais na equipe." };
    await updateDeal(id, { ownerId: to }, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível transferir o lead. Tente de novo."); }
}

const scheduleSchema = z.object({ dealId: uuid, scheduledAt: z.string().datetime({ offset: true }) });
/** Agendar (ou remarcar): o horário tem de ser futuro (erro). Fora do expediente a tela avisa, mas a Casa decide. Dado e etapa numa transação só. */
export async function scheduleAction(dealId: string, scheduledAt: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const input = scheduleSchema.safeParse({ dealId, scheduledAt });
    if (!input.success) return { ok: false, error: "Escolha a data e o horário." };
    await scheduleDeal(input.data.dealId, input.data.scheduledAt, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível agendar. Tente de novo."); }
}

const loseSchema = z.object({ dealId: uuid, reasonId: uuid, recontactAt: z.string().datetime({ offset: true }).nullable() });
/** Perdido: o motivo é obrigatório e tem de ser da lista de motivos de perda. "Retomar contato em" é opcional. Dado e etapa numa transação só. */
export async function loseAction(dealId: string, reasonId: string, recontactAt: string | null): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const input = loseSchema.safeParse({ dealId, reasonId, recontactAt });
    if (!input.success) return { ok: false, error: "Escolha o motivo da perda." };
    await loseDeal(input.data.dealId, input.data.reasonId, input.data.recontactAt, user.id);
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
    const user = await assertUser();
    const parsed = closeSaleInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: !(Number(input?.valueCents) >= 1) ? SALE_VALUE_REQUIRED : "Confira o serviço, o valor e a forma de pagamento." };
    const { alreadyClosed } = await closeSale(uuid.parse(dealId), parsed.data, user.id);
    revalidateLead();
    return { ok: true, data: { alreadyClosed } };
  } catch (e) { return safe(e, "Não foi possível fechar a venda. Tente de novo."); }
}

const ids = z.array(uuid).min(1, "Escolha pelo menos um lead.").max(BULK_MAX, `Escolha no máximo ${BULK_MAX} de cada vez.`);
/**
 * "Não é cliente" (um ou vários, até 100): sai da Fila, do Quadro e dos relatórios; nada é apagado. `ids` é o que o Desfazer restaura.
 * Um lead só (individual): qualquer pessoa da equipe pode, o salão é compartilhado. Vários (em massa): a atendente só age nos próprios leads e nos sem dono.
 */
export async function archiveAction(dealIds: string[]): Promise<ActionResult<{ archived: number; ids: string[]; skipped: number }>> {
  try {
    const user = await assertUser();
    const list = ids.parse(dealIds);
    const r = await bulkArchive(list, user, { scoped: list.length > 1 });
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível arquivar. Tente de novo."); }
}

export async function restoreAction(dealIds: string[]): Promise<ActionResult<{ restored: number; conflicts: string[]; skipped: number }>> {
  try {
    const user = await assertUser();
    const list = ids.parse(dealIds);
    const r = await bulkRestore(list, user, { scoped: list.length > 1 });
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível desfazer. Tente de novo."); }
}

/** "Atribuir a…" em massa: só a gestão. */
export async function bulkAssignAction(dealIds: string[], ownerId: string): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  try {
    const user = await assertUser("gestor");
    const r = await bulkAssign(ids.parse(dealIds), uuid.parse(ownerId), user);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível atribuir. Tente de novo."); }
}

/** "Mover etapa" em massa: só etapas que não pedem diálogo (o servidor confere). */
export async function bulkMoveAction(dealIds: string[], stageKey: string): Promise<ActionResult<{ moved: number; skipped: number }>> {
  try {
    const user = await assertUser();
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
/** Define a próxima ação do lead (uma por lead: a anterior é cancelada e fica no histórico). Individual: qualquer pessoa da equipe, o escopo de dono é só do em massa. */
export async function createNextActionAction(input: z.input<typeof nextActionInput>): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const v = nextActionInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Confira os dados." };
    await setNextAction(v.data.dealId, { title: v.data.title, dueAt: new Date(v.data.dueAt), assigneeId: v.data.assigneeId }, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível salvar a próxima ação. Tente de novo."); }
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
    const user = await assertUser();
    const id = uuid.parse(dealId);
    const r = await markAttendance(id, z.enum(["compareceu", "faltou"]).parse(status), user.id);
    revalidateLead();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível registrar. Tente de novo."); }
}

const originInput = z.union([
  z.object({ dealId: uuid, sourceId: uuid }),
  z.object({ dealId: uuid, origin: z.string().trim().min(1, "Escreva como a cliente conheceu a Casa.").max(40, "Use até 40 caracteres.") }),
]);
/** "Como conheceu?": grava a origem do lead (de uma origem cadastrada ou em texto livre), com a auditoria de/para. */
export async function setOriginAction(input: z.input<typeof originInput>): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const v = originInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Escolha uma opção." };
    if ("sourceId" in v.data) {
      const [src] = await db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.id, v.data.sourceId));
      if (!src) return { ok: false, error: "Essa origem não existe mais." };
      await updateDeal(v.data.dealId, { sourceId: v.data.sourceId }, user.id);
    } else await updateDeal(v.data.dealId, { origin: v.data.origin }, user.id);
    revalidateLead();
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível salvar a origem. Tente de novo."); }
}
