import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { reassignWaitAlerts } from "./wait-alerts";
import { z } from "zod";
import { clientFullName } from "@/lib/attempts";
import { db, type Tx } from "../db";
import { contacts, deals, dealEvents, auditLog, leadSources, lists, stages, tasks } from "../db/schema";
import { normalizePhone } from "./phone";
import { logEvent, emit } from "./events";
import { findOpenDeal, moveToKindTx, stageByKind } from "./deals";
import { FIELD_LABELS } from "../../lib/field-labels";
import { cancelRemarcarTx, completeTaskTx, nextDayMorning, replaceOpenTaskTx } from "./tasks";
import { UserFacingError } from "./errors";
import { closeAttendedTx, enterAttendedTx, enterMissedTx } from "./funnel";
import { assertProfessionalFor } from "./professionals";
import { cpfDigits, isValidCpf } from "../../lib/cpf";

export const ATTENDANCE = ["confirmado", "compareceu", "faltou", "remarcou"] as const;
const dateOrNull = z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).transform((v) => (v ? new Date(v) : null));
const uuidOrNull = z.union([z.string().uuid(), z.literal(""), z.null()]).transform((v) => v || null);

export const dealPatchSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  email: z.union([z.string().trim().email("E-mail inválido"), z.literal("")]).nullable().optional(),
  instagram: z.string().trim().max(60).nullable().optional(),
  /** CPF da cliente (painel da conversa). Guardado só com os dígitos; o histórico nunca leva o número. */
  cpf: z.string().max(20).nullable().optional(),
  birthday: z.union([z.string().regex(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/, "Use dia/mês, ex.: 14/11"), z.literal(""), z.null()]).optional(),
  observations: z.string().max(4000).nullable().optional(),
  /** Anotações da cliente (campo único do contato, Lote 2). `observations` fica só para o código antigo. */
  notes: z.string().max(4000).nullable().optional(),
  objectionId: uuidOrNull.optional(),
  lostReasonId: uuidOrNull.optional(),
  ownerId: uuidOrNull.optional(),
  /** Legado: grava também em `sourceLabel`. */
  origin: z.string().trim().min(1).max(40).optional(),
  sourceId: uuidOrNull.optional(),
  serviceId: uuidOrNull.optional(),
  professionalId: uuidOrNull.optional(),
  paidAt: dateOrNull.optional(),
  paidCents: z.union([z.number().int().min(0).max(1_000_000_000), z.null()]).optional(),
  attendance: z.union([z.enum(ATTENDANCE), z.null()]).optional(),
  valueCents: z.union([z.number().int().min(0).max(1_000_000_000), z.null()]).optional(),
  paymentMethod: z.union([z.enum(["pix", "cartao", "boleto", "dinheiro"]), z.literal(""), z.null()]).optional(),
  scheduledAt: dateOrNull.optional(),
  chargeAt: dateOrNull.optional(),
  recontactAt: dateOrNull.optional(),
});
export type DealPatch = z.input<typeof dealPatchSchema>;

/** Valor pronto para guardar no evento: datas viram texto, vazio vira null. */
const plain = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v === undefined || v === "" ? null : v);

async function assertService(tx: Tx, serviceId: string) {
  const [svc] = await tx.select({ kind: lists.kind }).from(lists).where(eq(lists.id, serviceId));
  if (svc?.kind !== "service") throw new Error("Serviço não encontrado");
}

export { UserFacingError } from "./errors";

/** A alteração de campos dentro de uma transação que já existe (quem chama emite o aviso depois do commit). */
export async function updateDealTx(tx: Tx, dealId: string, raw: DealPatch, userId: string | null) {
  const patch = dealPatchSchema.parse(raw);
  {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) throw new Error("Conversa não encontrada");
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, deal.contactId));
    const contactSet: Partial<typeof contacts.$inferInsert> = {};
    if (patch.name !== undefined) contactSet.name = patch.name || null;
    if (patch.email !== undefined) contactSet.email = patch.email || null;
    if (patch.instagram !== undefined) contactSet.instagram = patch.instagram ? patch.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") : null;
    if (patch.cpf !== undefined) {
      const digits = cpfDigits(patch.cpf);
      if (digits && !isValidCpf(digits)) throw new UserFacingError("CPF inválido");
      contactSet.cpf = digits || null;
    }
    if (patch.notes !== undefined) contactSet.notes = patch.notes?.trim() ? patch.notes.trim() : null;
    if (patch.birthday !== undefined) {
      if (!patch.birthday) Object.assign(contactSet, { birthDay: null, birthMonth: null, birthYear: null });
      else {
        const [d, m, y] = patch.birthday.split("/").map(Number);
        const test = new Date(Date.UTC(y || 2000, m - 1, d));
        if (test.getUTCMonth() !== m - 1 || test.getUTCDate() !== d) throw new Error("Data de aniversário inválida");
        Object.assign(contactSet, { birthDay: d, birthMonth: m, birthYear: y || null });
      }
    }
    const dealSet: Partial<typeof deals.$inferInsert> = {};
    for (const k of ["observations", "objectionId", "lostReasonId", "ownerId", "origin", "valueCents", "scheduledAt", "chargeAt", "recontactAt", "serviceId", "professionalId", "paidAt", "paidCents", "attendance"] as const) {
      if (patch[k] !== undefined) (dealSet as Record<string, unknown>)[k] = patch[k];
    }
    if (patch.paymentMethod !== undefined) dealSet.paymentMethod = patch.paymentMethod || null;
    if (patch.origin !== undefined) dealSet.sourceLabel = patch.origin;
    if (patch.sourceId !== undefined) {
      dealSet.sourceId = patch.sourceId;
      if (patch.sourceId) {
        const [src] = await tx.select().from(leadSources).where(eq(leadSources.id, patch.sourceId));
        if (!src) throw new Error("Origem não encontrada");
        dealSet.sourceLabel = src.label;
        dealSet.origin = src.label;
      }
    }
    if (patch.serviceId) await assertService(tx, patch.serviceId);
    if (patch.attendance !== undefined) dealSet.attendanceAt = patch.attendance ? new Date() : null;

    // Auditoria: só o que mudou, com o valor de antes e o de depois.
    const before: Record<string, unknown> = {
      ...Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, (deal as Record<string, unknown>)[k]])),
      name: contact.name, email: contact.email, instagram: contact.instagram, notes: contact.notes,
      cpf: contact.cpf ? "informado" : null,
      birthday: contact.birthDay ? `${contact.birthDay}/${contact.birthMonth}${contact.birthYear ? `/${contact.birthYear}` : ""}` : null,
    };
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[k] === undefined) continue;
      after[k] = k === "notes" ? (patch.notes?.trim() || null) : k === "cpf" ? (contactSet.cpf ? (contact.cpf && contact.cpf !== contactSet.cpf ? "trocado" : "informado") : null) : patch[k];
    }
    // Aniversário: compara normalizado ("05/03" é o mesmo que 5/3 guardado).
    const normBirthday = (v: unknown) => (typeof v === "string" && v ? v.split("/").map(Number).join("/") : v);
    const campos = Object.keys(after)
      .map((k) => ({ campo: k, de: plain(k === "birthday" ? normBirthday(before[k]) : before[k]), para: plain(k === "birthday" ? normBirthday(after[k]) : after[k]) }))
      .filter((c) => JSON.stringify(c.de) !== JSON.stringify(c.para));

    if (patch.scheduledAt !== undefined && patch.scheduledAt?.getTime() !== deal.scheduledAt?.getTime()) {
      // Agendar (ou remarcar) troca a tarefa de comparecimento em aberto: conferir no dia seguinte.
      const quem = contactSet.name ?? contact.name;
      await replaceOpenTaskTx(tx, dealId, deal.contactId, "comparecimento",
        patch.scheduledAt ? { title: `Conferir se ${clientFullName(quem?.trim() || contact.phoneE164)} veio`, dueAt: nextDayMorning(patch.scheduledAt), assigneeId: dealSet.ownerId !== undefined ? dealSet.ownerId : deal.ownerId } : null, userId);
    }

    if (Object.keys(contactSet).length) await tx.update(contacts).set(contactSet).where(eq(contacts.id, deal.contactId));
    if (Object.keys(dealSet).length) await tx.update(deals).set(dealSet).where(eq(deals.id, dealId));
    // Nova dona: o alerta de atraso da espera em aberto vai com a conversa (transferir, atribuir em massa, trocar no Quadro).
    if (campos.some((c) => c.campo === "ownerId")) await reassignWaitAlerts(tx, dealId, (dealSet.ownerId as string | null | undefined) ?? null);
    if (campos.length) {
      await logEvent(tx, dealId, patch.ownerId !== undefined && campos.some((c) => c.campo === "ownerId") ? "responsavel_alterado" : "campo_alterado", { campos }, userId);
      await tx.insert(auditLog).values({ userId, action: "atualizou", entity: "deal", entityId: dealId, data: { campos: campos.map((c) => c.campo) } });
    }
  }
}

export async function updateDeal(dealId: string, raw: DealPatch, userId: string) {
  await db.transaction((tx) => updateDealTx(tx, dealId, raw, userId));
  await emit("lead_atualizado", { dealId });
}

/** Agendar (ou remarcar): o horário e a etapa Agendado numa transação só; se a mudança de etapa falhar, o horário não fica gravado. */
/** Outro horário da mesma profissional a menos de 1 hora (não impede: a Casa decide; a tela avisa). */
export type ScheduleConflict = { name: string; at: string };
const CONFLICT_MS = 60 * 60_000;

/**
 * Agendar: dia e hora, e opcionalmente o serviço e a profissional que vai fazer. A profissional precisa estar ativa e fazer o serviço.
 * Devolve os horários da mesma profissional a menos de 1 hora, para a tela avisar.
 */
export async function scheduleDeal(dealId: string, scheduledAt: Date | string, userId: string, now = new Date(),
  opts: { serviceId?: string | null; professionalId?: string | null } = {}): Promise<{ conflicts: ScheduleConflict[] }> {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) throw new UserFacingError("Escolha a data e o horário.");
  if (at.getTime() <= now.getTime()) throw new UserFacingError("Escolha um horário que ainda não passou.");
  const conflicts = await db.transaction(async (tx) => {
    if (opts.professionalId) await assertProfessionalFor(tx, opts.professionalId, opts.serviceId ?? null);
    await updateDealTx(tx, dealId, {
      scheduledAt: at.toISOString(),
      ...(opts.serviceId !== undefined ? { serviceId: opts.serviceId } : {}),
      ...(opts.professionalId !== undefined ? { professionalId: opts.professionalId } : {}),
    }, userId);
    await moveToKindTx(tx, dealId, "agendado", userId, "manual");
    if (!opts.professionalId) return [];
    const rows = await tx.select({ name: contacts.name, phone: contacts.phoneE164, at: deals.scheduledAt }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
      .where(and(eq(deals.professionalId, opts.professionalId), ne(deals.id, dealId), isNull(deals.archivedAt),
        gt(deals.scheduledAt, new Date(at.getTime() - CONFLICT_MS)), lt(deals.scheduledAt, new Date(at.getTime() + CONFLICT_MS))))
      .orderBy(asc(deals.scheduledAt));
    return rows.map((r) => ({ name: r.name?.trim() || r.phone, at: new Date(r.at!).toISOString() }));
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
  return { conflicts };
}

/** O motivo "Outro" do Perdido (pedido do dono, 16/10): o texto escrito fica em `deals.lostReasonDetail`. */
export const OTHER_LOST_REASON = "Outro";
export const OTHER_REASON_ID = "outro";
export const LOST_DETAIL_MAX = 200;

/**
 * Perdido: motivo (da lista de motivos de perda, ou "Outro" com o texto escrito), retomada opcional e a etapa Perdido numa transação só.
 * `reasonId` = "outro" usa (e cria, se faltar) o motivo "Outro" da lista; o texto é obrigatório nesse caso.
 */
export async function loseDeal(dealId: string, reasonId: string, recontactAt: Date | string | null, userId: string, now = new Date(), detail?: string | null) {
  const recontact = recontactAt ? new Date(recontactAt) : null;
  if (recontact && (Number.isNaN(recontact.getTime()) || recontact.getTime() <= now.getTime())) throw new UserFacingError("A data para retomar o contato precisa ser futura.");
  const other = reasonId === OTHER_REASON_ID;
  const text = other ? detail?.trim() ?? "" : "";
  if (other && !text) throw new UserFacingError("Escreva qual é o motivo.");
  if (text.length > LOST_DETAIL_MAX) throw new UserFacingError(`Resuma o motivo em até ${LOST_DETAIL_MAX} caracteres.`);
  await db.transaction(async (tx) => {
    let id = reasonId;
    if (other) {
      await tx.insert(lists).values({ kind: "lost_reason", label: OTHER_LOST_REASON, position: 999 }).onConflictDoNothing();
      [{ id }] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, OTHER_LOST_REASON)));
    } else {
      const [reason] = await tx.select({ kind: lists.kind }).from(lists).where(eq(lists.id, reasonId));
      if (reason?.kind !== "lost_reason") throw new UserFacingError("Esse motivo não existe mais. Escolha outro.");
    }
    await updateDealTx(tx, dealId, { lostReasonId: id, recontactAt: recontact ? recontact.toISOString() : null }, userId);
    const [before] = await tx.select({ detail: deals.lostReasonDetail }).from(deals).where(eq(deals.id, dealId));
    if ((before?.detail ?? null) !== (text || null)) {
      await tx.update(deals).set({ lostReasonDetail: text || null }).where(eq(deals.id, dealId));
      if (text) await logEvent(tx, dealId, "campo_alterado", { campos: [{ campo: "lostReasonDetail", de: before?.detail ?? null, para: text }] }, userId);
    }
    await moveToKindTx(tx, dealId, "perdido", userId, "manual");
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
}

/** Lead criado na mão (ex.: cliente que ligou ou chegou na recepção). */
export async function createManualLead(input: { phone: string; name?: string; origin?: string }, userId: string) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Telefone inválido. Use DDD + número, ex.: 71 99999-9999");
  const dealId = await db.transaction(async (tx) => {
    const [c] = await tx.insert(contacts).values({ phoneE164: phone, name: input.name?.trim() || null })
      // Lead criado na mão = a gestão considera cliente: tira a marca de "não é cliente", se houver.
      .onConflictDoUpdate({ target: contacts.phoneE164, set: { name: input.name?.trim() || undefined, ignored: false } }).returning();
    const existing = await findOpenDeal(c.id, tx);
    if (existing) return existing.id;
    const lead = await stageByKind("atendimento", tx);
    const at = new Date(); // hora do app, a mesma fonte dos leads do WhatsApp (ver start-conversation.ts)
    const [d] = await tx.insert(deals).values({ contactId: c.id, stageId: lead.id, ownerId: userId, origin: input.origin || "Recepção", sourceLabel: input.origin || "Recepção", createdAt: at, stageEnteredAt: at }).returning();
    await logEvent(tx, d.id, "lead_criado", { origin: d.origin, initialStage: lead.key, historico: false, manual: true }, userId);
    return d.id;
  });
  await emit("lead_criado", { dealId });
  return dealId;
}

const closeSaleSchema = z.object({
  serviceId: z.string().uuid(),
  valueCents: z.number().int().min(1, "Informe o valor da venda").max(1_000_000_000),
  paymentMethod: z.enum(["pix", "cartao", "boleto", "dinheiro"]),
  paidNow: z.boolean(),
});
export type CloseSaleInput = z.input<typeof closeSaleSchema>;

/**
 * Registrar venda numa transação só: serviço, valor, forma de pagamento (e pago, se foi agora), a conversa termina em Atendida e o evento `venda`.
 * Idempotente: se o lead já está fechado, devolve sem mexer nem duplicar o evento.
 */
export async function closeSale(dealId: string, raw: CloseSaleInput, userId: string): Promise<{ alreadyClosed: boolean }> {
  const input = closeSaleSchema.parse(raw);
  const alreadyClosed = await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!deal) throw new Error("Conversa não encontrada");
    if (deal.archivedAt) throw new Error("Conversa arquivada não pode fechar venda");
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (stage?.kind === "fechado" || (stage?.kind === "atendido" && deal.closedAt)) return true;
    await assertService(tx, input.serviceId);
    const [svc] = await tx.select({ label: lists.label, cycleDays: lists.cycleDays }).from(lists).where(eq(lists.id, input.serviceId));
    const now = new Date();
    await tx.update(deals).set({
      serviceId: input.serviceId, valueCents: input.valueCents, paymentMethod: input.paymentMethod,
      ...(input.paidNow ? { paidAt: now, paidCents: input.valueCents } : {}),
      // Uma venda não guarda motivo de perda (lead que estava em Perdido e foi recuperado).
      ...(stage?.kind === "perdido" ? { lostReasonId: null } : {}),
    }).where(eq(deals.id, dealId));
    // Sem a etapa Fechado (nova organização, 16/10): a venda termina a conversa em Atendida.
    await closeAttendedTx(tx, dealId, userId, "venda", now);
    await logEvent(tx, dealId, "venda", { serviceId: input.serviceId, valueCents: input.valueCents, paymentMethod: input.paymentMethod, paid: input.paidNow }, userId);
    // Serviço com ciclo (ex.: coloração a cada 35 dias): lembrete de retorno a partir do fechamento.
    if (svc?.cycleDays) {
      await replaceOpenTaskTx(tx, dealId, deal.contactId, "retorno",
        { title: `Retorno de ${svc.label}`, dueAt: new Date(now.getTime() + svc.cycleDays * 86_400_000), assigneeId: deal.ownerId }, userId);
    }
    await tx.insert(auditLog).values({ userId, action: "fechou_venda", entity: "deal", entityId: dealId, data: { valueCents: input.valueCents } });
    return false;
  });
  if (!alreadyClosed) await emit("etapa_alterada", { dealId });
  return { alreadyClosed };
}

/** O comparecimento dentro de uma transação que já existe (quem chama emite o aviso depois do commit). */
export async function setAttendanceTx(tx: Tx, dealId: string, status: (typeof ATTENDANCE)[number], userId: string | null) {
  const value = z.enum(ATTENDANCE).parse(status);
  const [deal] = await tx.select({ attendance: deals.attendance }).from(deals).where(eq(deals.id, dealId)).for("update");
  if (!deal) throw new Error("Conversa não encontrada");
  await tx.update(deals).set({ attendance: value, attendanceAt: new Date() }).where(eq(deals.id, dealId));
  await logEvent(tx, dealId, "comparecimento", { de: deal.attendance, para: value }, userId);
  // A conferência de comparecimento está feita: conclui a tarefa aberta (e o aviso dela). Confirmar o horário não é comparecer.
  if (value === "compareceu") await cancelRemarcarTx(tx, dealId, userId); // corrigiu um Faltou: o Remarcar que ele criou não vale mais
  if (value !== "confirmado") {
    const open = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)));
    for (const t of open) await completeTaskTx(tx, t.id, userId);
  }
}

/** Marca o comparecimento do agendamento (a enquete de confirmação grava "confirmado", sem autor). */
export async function setAttendance(dealId: string, status: (typeof ATTENDANCE)[number], userId: string | null) {
  await db.transaction((tx) => setAttendanceTx(tx, dealId, status, userId));
  await emit("lead_atualizado", { dealId });
}

/**
 * "Compareceu" / "Faltou" na Fila e no painel (Lote 1C): Compareceu → Atendida (com o pós-atendimento); Faltou → Aguardando cliente
 * com o Remarcar como 1ª tentativa (mantém a próxima ação futura que já estava combinada). Vale para Agendado e para a correção de um
 * Compareceu/Faltou já marcado (a conversa já está em Atendida ou Aguardando). Repetir o mesmo valor não faz nada.
 */
export async function markAttendance(dealId: string, status: "compareceu" | "faltou", userId: string, now = new Date()): Promise<{ changed: boolean; remarcar: boolean }> {
  const value = z.enum(["compareceu", "faltou"]).parse(status);
  const r = await db.transaction(async (tx) => {
    const [row] = await tx.select({ attendance: deals.attendance, archivedAt: deals.archivedAt, kind: stages.kind })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    if (!row) throw new UserFacingError("Conversa não encontrada");
    if (row.archivedAt) throw new UserFacingError("Essa conversa saiu da fila.");
    // Corrigir depois: Compareceu levou para Atendida; Faltou levou para Em conversa esperando a cliente (antes, Aguardando cliente).
    const correcting = !!row.attendance && (row.kind === "atendido" || row.kind === "followup" || (row.kind === "atendimento" && row.attendance === "faltou"));
    if (row.kind !== "agendado" && row.kind !== "na_casa" && !correcting) throw new UserFacingError("Só dá para conferir se ela veio numa conversa com horário marcado.");
    if (row.attendance === value) return { changed: false, remarcar: false };
    // Faltou guarda como a conversa estava (QA r58, M-2): o Desfazer volta exatamente isso (`undoMissedAttendance`).
    const snap = value === "faltou" ? await missSnapshotTx(tx, dealId) : null;
    await setAttendanceTx(tx, dealId, value, userId);
    if (value === "compareceu") { await enterAttendedTx(tx, dealId, userId, "compareceu", now, { visitAt: now }); return { changed: true, remarcar: false }; }
    const out = await enterMissedTx(tx, dealId, userId, "faltou", now);
    if (snap) await logMissSnapshotTx(tx, dealId, snap, userId);
    return { changed: true, ...out };
  });
  if (r.changed) { await emit("lead_atualizado", { dealId }); await emit("etapa_alterada", { dealId }); }
  return r;
}

/**
 * O que o Desfazer do Faltou restaura: só as colunas que a falta muda (comparecimento, etapa, tentativas e espera; `setAttendanceTx`,
 * `enterMissedTx`, `moveToKindTx`, `waitForClientTx`) e os combinados abertos naquela hora. Nunca a linha inteira: o visto (`seen_at`) e
 * outras escritas sem evento continuam como estão (revisão de 18/10).
 */
const DEAL_COLUMNS = getTableColumns(deals);
const MISS_COLUMNS = ["stageId", "stageEnteredAt", "attendance", "attendanceAt", "followupAttempt", "followupDueAt", "followupTaskId", "awaitingReplySince",
  "closedAt", "conversationArchivedAt", "recontactAt", "resolvedAt", "resolvedById"] as const;
type MissSnapshot = { deal: Record<string, unknown>; openTasks: string[] };
async function openTaskIds(tx: Tx, dealId: string) {
  return (await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt)))).map((t) => t.id);
}
async function missSnapshotTx(tx: Tx, dealId: string): Promise<MissSnapshot> {
  const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
  return { deal: d as unknown as Record<string, unknown>, openTasks: await openTaskIds(tx, dealId) };
}
async function logMissSnapshotTx(tx: Tx, dealId: string, snap: MissSnapshot, userId: string) {
  const after = await openTaskIds(tx, dealId);
  await logEvent(tx, dealId, "falta_marcada", {
    antes: snap.deal, criadas: after.filter((id) => !snap.openTasks.includes(id)), fechadas: snap.openTasks.filter((id) => !after.includes(id)),
  }, userId);
}

/**
 * Desfazer o "Faltou" da conversa (QA r58, M-2): volta a conversa como estava antes da falta (etapa, comparecimento, tentativas), apaga o
 * Remarcar que a falta criou e reabre o combinado que ela concluiu. Só se nada aconteceu na conversa depois (mensagem, etapa, combinado).
 */
export async function undoMissedAttendance(dealId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d || d.attendance !== "faltou") throw new UserFacingError("Não há falta para desfazer nesta conversa.");
    const [ev] = await tx.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "falta_marcada"))).orderBy(desc(dealEvents.createdAt)).limit(1);
    if (!ev) throw new UserFacingError("Não há falta para desfazer nesta conversa.");
    // Os eventos da própria falta têm a mesma hora (mesma transação); qualquer coisa depois é mudança de outra pessoa ou da cliente.
    // (Comparado no banco: o Date do JS corta os microssegundos.)
    const [later] = await tx.select({ id: dealEvents.id }).from(dealEvents)
      .where(and(eq(dealEvents.dealId, dealId), sql`${dealEvents.createdAt} > (select e.created_at from deal_events e where e.id = ${ev.id})`)).limit(1);
    if (later) throw new UserFacingError("A conversa mudou depois da falta: corrija pelo botão Veio ou pela etapa.");
    const p = ev.payload as { antes: Record<string, unknown>; criadas: string[]; fechadas: string[] };
    const restore: Record<string, unknown> = {};
    for (const key of MISS_COLUMNS) {
      const col = (DEAL_COLUMNS as Record<string, { dataType: string }>)[key];
      if (!col || !(key in p.antes)) continue;
      const v = p.antes[key];
      restore[key] = v != null && col.dataType === "date" && typeof v === "string" ? new Date(v) : v;
    }
    await tx.update(deals).set(restore as Partial<typeof deals.$inferInsert>).where(eq(deals.id, dealId));
    if (p.criadas.length) await tx.delete(tasks).where(and(eq(tasks.dealId, dealId), inArray(tasks.id, p.criadas)));
    if (p.fechadas.length) {
      await tx.update(tasks).set({ doneAt: null }).where(and(eq(tasks.dealId, dealId), inArray(tasks.id, p.fechadas)));
      // O aviso do combinado que a falta concluiu volta junto (`completeTaskTx` resolve o `task:<id>`).
      await tx.execute(sql`update alerts set resolved_at = null where wait_key in (${sql.join(p.fechadas.map((t) => sql`${`task:${t}`}`), sql`, `)})
        and resolved_at >= (select e.created_at from deal_events e where e.id = ${ev.id})`);
    }
    await logEvent(tx, dealId, "falta_desfeita", {}, userId);
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
}
