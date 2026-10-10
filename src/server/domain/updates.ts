import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { contacts, deals, auditLog, leadSources, lists, stages, tasks } from "../db/schema";
import { normalizePhone } from "./phone";
import { logEvent, emit } from "./events";
import { findOpenDeal, stageByKey, moveDealTx } from "./deals";
import { FIELD_LABELS } from "../../lib/field-labels";
import { cancelRemarcarTx, completeTaskTx, nextDayMorning, REMARCAR_META, remarcarDueAt, replaceOpenTaskTx, setNextActionTx } from "./tasks";
import { UserFacingError } from "./errors";

export const ATTENDANCE = ["confirmado", "compareceu", "faltou", "remarcou"] as const;
const dateOrNull = z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).transform((v) => (v ? new Date(v) : null));
const uuidOrNull = z.union([z.string().uuid(), z.literal(""), z.null()]).transform((v) => v || null);

export const dealPatchSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  email: z.union([z.string().trim().email("E-mail inválido"), z.literal("")]).nullable().optional(),
  instagram: z.string().trim().max(60).nullable().optional(),
  birthday: z.union([z.string().regex(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/, "Use dia/mês, ex.: 14/11"), z.literal(""), z.null()]).optional(),
  observations: z.string().max(4000).nullable().optional(),
  objectionId: uuidOrNull.optional(),
  lostReasonId: uuidOrNull.optional(),
  ownerId: uuidOrNull.optional(),
  /** Legado: grava também em `sourceLabel`. */
  origin: z.string().trim().min(1).max(40).optional(),
  sourceId: uuidOrNull.optional(),
  serviceId: uuidOrNull.optional(),
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
export async function updateDealTx(tx: Tx, dealId: string, raw: DealPatch, userId: string) {
  const patch = dealPatchSchema.parse(raw);
  {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) throw new Error("Lead não encontrado");
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, deal.contactId));
    const contactSet: Partial<typeof contacts.$inferInsert> = {};
    if (patch.name !== undefined) contactSet.name = patch.name || null;
    if (patch.email !== undefined) contactSet.email = patch.email || null;
    if (patch.instagram !== undefined) contactSet.instagram = patch.instagram ? patch.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") : null;
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
    for (const k of ["observations", "objectionId", "lostReasonId", "ownerId", "origin", "valueCents", "scheduledAt", "chargeAt", "recontactAt", "serviceId", "paidAt", "paidCents", "attendance"] as const) {
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
      name: contact.name, email: contact.email, instagram: contact.instagram,
      birthday: contact.birthDay ? `${contact.birthDay}/${contact.birthMonth}${contact.birthYear ? `/${contact.birthYear}` : ""}` : null,
    };
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[k] === undefined) continue;
      after[k] = patch[k];
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
        patch.scheduledAt ? { title: `Conferir se ${quem?.trim() || "a cliente"} compareceu`, dueAt: nextDayMorning(patch.scheduledAt), assigneeId: dealSet.ownerId !== undefined ? dealSet.ownerId : deal.ownerId } : null, userId);
    }

    if (Object.keys(contactSet).length) await tx.update(contacts).set(contactSet).where(eq(contacts.id, deal.contactId));
    if (Object.keys(dealSet).length) await tx.update(deals).set(dealSet).where(eq(deals.id, dealId));
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
export async function scheduleDeal(dealId: string, scheduledAt: Date | string, userId: string, now = new Date()) {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) throw new UserFacingError("Escolha a data e o horário.");
  if (at.getTime() <= now.getTime()) throw new UserFacingError("Escolha um horário que ainda não passou.");
  await db.transaction(async (tx) => {
    await updateDealTx(tx, dealId, { scheduledAt: at.toISOString() }, userId);
    await moveDealTx(tx, dealId, "agendado", userId, "manual");
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
}

/** Perdido: motivo (da lista de motivos de perda), retomada opcional e a etapa Perdido numa transação só. */
export async function loseDeal(dealId: string, reasonId: string, recontactAt: Date | string | null, userId: string, now = new Date()) {
  const recontact = recontactAt ? new Date(recontactAt) : null;
  if (recontact && (Number.isNaN(recontact.getTime()) || recontact.getTime() <= now.getTime())) throw new UserFacingError("A data para retomar o contato precisa ser futura.");
  await db.transaction(async (tx) => {
    const [reason] = await tx.select({ kind: lists.kind }).from(lists).where(eq(lists.id, reasonId));
    if (reason?.kind !== "lost_reason") throw new UserFacingError("Esse motivo não existe mais. Escolha outro.");
    await updateDealTx(tx, dealId, { lostReasonId: reasonId, recontactAt: recontact ? recontact.toISOString() : null }, userId);
    await moveDealTx(tx, dealId, "perdido", userId, "manual");
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
    const lead = await stageByKey("atendimento", tx);
    const [d] = await tx.insert(deals).values({ contactId: c.id, stageId: lead.id, ownerId: userId, origin: input.origin || "Recepção", sourceLabel: input.origin || "Recepção" }).returning();
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
 * Fechar venda numa transação só: serviço, valor, forma de pagamento (e pago, se foi agora), etapa Fechado e evento `venda`.
 * Idempotente: se o lead já está fechado, devolve sem mexer nem duplicar o evento.
 */
export async function closeSale(dealId: string, raw: CloseSaleInput, userId: string): Promise<{ alreadyClosed: boolean }> {
  const input = closeSaleSchema.parse(raw);
  const alreadyClosed = await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!deal) throw new Error("Lead não encontrado");
    if (deal.archivedAt) throw new Error("Lead arquivado não pode fechar venda");
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (stage?.kind === "fechado") return true;
    await assertService(tx, input.serviceId);
    const [svc] = await tx.select({ label: lists.label, cycleDays: lists.cycleDays }).from(lists).where(eq(lists.id, input.serviceId));
    const now = new Date();
    await tx.update(deals).set({
      serviceId: input.serviceId, valueCents: input.valueCents, paymentMethod: input.paymentMethod,
      ...(input.paidNow ? { paidAt: now, paidCents: input.valueCents } : {}),
      // Uma venda não guarda motivo de perda (lead que estava em Perdido e foi recuperado).
      ...(stage?.kind === "perdido" ? { lostReasonId: null } : {}),
    }).where(eq(deals.id, dealId));
    await moveDealTx(tx, dealId, "fechado", userId, "venda", now);
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
  if (!deal) throw new Error("Lead não encontrado");
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
 * "Compareceu" / "Faltou" na Fila e no painel: grava o comparecimento e conclui a conferência, tudo na mesma transação.
 * Quem faltou ganha a próxima ação "Remarcar" (amanhã 10h, dono do lead) SÓ se não houver próxima ação aberta: o que a atendente planejou não é sobrescrito.
 * Corrigir Faltou → Compareceu cancela o Remarcar que o Faltou criou. Só vale para lead aberto na etapa Agendado; repetir o mesmo valor não faz nada.
 * `remarcar`: true se o Remarcar foi criado (o aviso da tela diz o que aconteceu).
 */
export async function markAttendance(dealId: string, status: "compareceu" | "faltou", userId: string, now = new Date()): Promise<{ changed: boolean; remarcar: boolean }> {
  const value = z.enum(["compareceu", "faltou"]).parse(status);
  const r = await db.transaction(async (tx) => {
    const [row] = await tx.select({ attendance: deals.attendance, archivedAt: deals.archivedAt, ownerId: deals.ownerId, kind: stages.kind, name: contacts.name })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
    if (!row) throw new UserFacingError("Lead não encontrado");
    if (row.archivedAt) throw new UserFacingError("Esse lead saiu da fila.");
    if (row.kind !== "agendado") throw new UserFacingError("Só dá para conferir o comparecimento de um lead agendado.");
    if (row.attendance === value) return { changed: false, remarcar: false };
    await setAttendanceTx(tx, dealId, value, userId);
    let remarcar = false;
    if (value === "faltou") {
      const [open] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).limit(1);
      if (!open) {
        await setNextActionTx(tx, dealId, { title: `Remarcar com ${row.name?.trim() || "a cliente"}`, dueAt: remarcarDueAt(now), assigneeId: row.ownerId, meta: { ...REMARCAR_META } }, userId, now);
        remarcar = true;
      }
    }
    return { changed: true, remarcar };
  });
  if (r.changed) await emit("lead_atualizado", { dealId });
  return r;
}
