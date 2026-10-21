import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Tx } from "../../db";
import { auditLog, comandaItemAssistants, comandaItems, comandas, commissionPayouts, professionalAdjustments, professionals, users } from "../../db/schema";
import { shiftDay, todayBahia } from "@/lib/agenda";
import { firstName } from "@/lib/authorship";
import { displayName } from "@/lib/display-name";
import { formatBRL } from "@/lib/money";
import { isUuid } from "@/lib/uuid";
import type { AdjustmentKind } from "@/lib/adjustments";
import { brDate, payoutTotals, type Payable, type PayableAdjustment, type PayableLine, type PayablePending, type PayoutReceipt, type PayoutRow } from "@/lib/payouts";
import { lockKeyTx } from "../agenda/locks";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";
import { cancelTx, materializeRulesTx } from "./adjustments";
import { assertRecurso, getCaixaRecursos } from "./recursos";

/**
 * Pagar a comissão (Fase A, Tarefa 9; decisões 10 e 11). Paga tudo o que não foi pago até a data escolhida: as linhas de comanda fechada
 * (da principal e as de assistente, cada uma no recibo de quem recebe), menos as retidas pela dívida e as sem regra, mais os lançamentos
 * (vale, bônus, desconto na comissão). Recibo com número sequencial. Vales e descontos maiores que o que entra: recibo de R$ 0 e a diferença
 * vira "Desconto na comissão" do dia seguinte ("Saldo do recibo nº N"). Desfazer pede motivo e devolve tudo ao "A pagar".
 *
 * Concorrência: pagar trava `repasse:<profissional>` (dois cliques ou duas pessoas = um recibo só) e as linhas que paga (FOR UPDATE nas
 * comandas, nos itens e nos lançamentos), então reabrir, cancelar ou cancelar o lançamento ao mesmo tempo espera e depois vê o recibo.
 * Não depende do modo do caixa; quem pode é conferido na ação (`comissao.pagar`).
 */
export type { Payable, PayoutReceipt, PayoutRow };

const COMMISSIONED = ["servico", "pacote_sessao"];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

type Status = "ok" | PayablePending["why"];
const statusOf = (o: { kind: string; base: number | null; bp: number | null; value: number | null; held: boolean }): Status =>
  o.held ? "aguardando_quitacao" : o.kind === "pacote_sessao" && o.base == null ? "sem_valor_sessao" : o.bp == null || o.value == null ? "sem_regra" : "ok";

/** O "A pagar" lido dentro da transação; com `lock`, trava as comandas, os itens e os lançamentos que vão entrar no recibo. */
async function payableTx(tx: Tx, professionalId: string, until: string, lock = false): Promise<Payable> {
  const [pro] = isUuid(professionalId) ? await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, professionalId)) : [];
  if (!pro) throw new UserFacingError("Profissional não encontrada.");
  // "Pagar comissão a partir de" (Configurações › Caixa): o que é de antes foi pago fora do CRM e nunca entra.
  const desde = (await getCaixaRecursos(tx)).pagarComissaoDesde;
  const closed = and(eq(comandas.status, "fechada"), lte(comandas.day, until), desde ? gte(comandas.day, desde) : undefined, isNull(comandaItems.cancelledAt), inArray(comandaItems.kind, COMMISSIONED));
  const principal = alias(professionals, "principal");
  const mainsQ = tx.select({
    id: comandaItems.id, day: comandas.day, number: comandas.number, clientName: comandas.clientName, label: comandaItems.label, kind: comandaItems.kind, createdAt: comandaItems.createdAt,
    base: comandaItems.commissionBaseCents, bp: comandaItems.commissionBp, value: comandaItems.commissionCents, held: comandaItems.commissionHeld,
  }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(closed, eq(comandaItems.professionalId, professionalId), isNull(comandaItems.payoutId)))
    .orderBy(asc(comandas.day), asc(comandas.number), asc(comandaItems.createdAt));
  const helpersQ = tx.select({
    id: comandaItemAssistants.id, day: comandas.day, number: comandas.number, clientName: comandas.clientName, label: comandaItems.label, kind: comandaItems.kind, createdAt: comandaItems.createdAt,
    base: comandaItemAssistants.baseCents, bp: comandaItemAssistants.bp, value: comandaItemAssistants.commissionCents, held: comandaItems.commissionHeld, principalName: principal.name,
  }).from(comandaItemAssistants).innerJoin(comandaItems, eq(comandaItems.id, comandaItemAssistants.comandaItemId)).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .innerJoin(principal, eq(principal.id, comandaItems.professionalId))
    // Assistente ignorada no Finalizar (recurso desligado) fica sem base e não é linha (como no relatório).
    .where(and(closed, eq(comandaItemAssistants.professionalId, professionalId), isNull(comandaItemAssistants.payoutId),
      or(isNotNull(comandaItemAssistants.baseCents), isNull(comandaItems.commissionBaseCents))))
    .orderBy(asc(comandas.day), asc(comandas.number), asc(comandaItems.createdAt));
  const adjQ = tx.select().from(professionalAdjustments)
    .where(and(eq(professionalAdjustments.professionalId, professionalId), isNull(professionalAdjustments.cancelledAt), isNull(professionalAdjustments.payoutId), lte(professionalAdjustments.day, until),
      desde ? gte(professionalAdjustments.day, desde) : undefined))
    .orderBy(asc(professionalAdjustments.day), asc(professionalAdjustments.createdAt));
  // Em sequência: a mesma conexão da transação não roda duas consultas ao mesmo tempo.
  const mains = lock ? await mainsQ.for("update", { of: [comandaItems, comandas] }) : await mainsQ;
  const helpers = lock ? await helpersQ.for("update", { of: [comandaItemAssistants, comandaItems, comandas] }) : await helpersQ;
  const adjs = lock ? await adjQ.for("update") : await adjQ;

  type Row = { day: string; number: number; createdAt: Date; status: Status; line: PayableLine };
  const rows: Row[] = [
    ...mains.map((r): Row => ({ ...r, status: statusOf(r), line: { kind: "item", id: r.id, day: r.day, comandaNumber: r.number, clientName: r.clientName ?? "Cliente", label: r.label, commissionCents: r.value ?? 0 } })),
    ...helpers.map((r): Row => ({ ...r, status: statusOf(r), line: { kind: "assistente", id: r.id, day: r.day, comandaNumber: r.number, clientName: r.clientName ?? "Cliente",
      label: `${r.label} (assistente de ${displayName(r.principalName)})`, commissionCents: r.value ?? 0 } })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number || a.createdAt.getTime() - b.createdAt.getTime() || (a.line.kind === b.line.kind ? 0 : a.line.kind === "item" ? -1 : 1));
  const lines = rows.filter((r) => r.status === "ok").map((r) => r.line);
  const pending = rows.filter((r) => r.status !== "ok").map((r): PayablePending => ({ day: r.day, label: r.line.label, why: r.status as PayablePending["why"] }));
  const adjustments = adjs.map((a): PayableAdjustment => ({ id: a.id, kind: a.kind as AdjustmentKind, day: a.day, valueCents: a.valueCents, note: a.note }));
  const days = [...lines.map((l) => l.day), ...adjustments.map((a) => a.day)].sort();
  const { carriedCents: _carried, ...totals } = payoutTotals(lines, adjustments);
  return { professionalId, name: pro.name, fromDay: days[0] ?? null, untilDay: until, lines, adjustments, pending, totals };
}

function checkDay(until: unknown): asserts until is string {
  if (typeof until !== "string" || !DAY.test(until)) throw new UserFacingError("Escolha até que dia pagar.");
}

/** O "A pagar" de uma profissional até `until` (gera antes os "todo mês" até lá, idempotente). */
export async function payableFor(o: { professionalId: string; until: string }, now = new Date()): Promise<Payable> {
  checkDay(o.until);
  return db.transaction(async (tx) => {
    await materializeRulesTx(tx, o.until, o.professionalId, now);
    return payableTx(tx, o.professionalId, o.until);
  });
}

/**
 * Paga e numera. `expectedNetCents` é o total que a tela mostrou: se mudou (outra pessoa pagou, uma comanda fechou ou reabriu, um vale
 * entrou), recusa com o valor de agora. Os "todo mês" nascem aqui dentro, depois da trava.
 */
export async function payCommission(input: { professionalId: string; until: string; expectedNetCents: number; note?: string | null }, actor: Actor, now = new Date()): Promise<{ id: string; number: number; netCents: number }> {
  checkDay(input.until);
  if (input.until > todayBahia(now)) throw new UserFacingError("Escolha um dia até hoje.");
  if (!Number.isInteger(input.expectedNetCents)) throw new UserFacingError("Confira o valor.");
  const note = (input.note ?? "").trim().slice(0, 300) || null;
  return db.transaction(async (tx) => {
    await assertRecurso("pagarComissao", tx);
    await lockKeyTx(tx, `repasse:${input.professionalId}`);
    await materializeRulesTx(tx, input.until, input.professionalId, now);
    const p = await payableTx(tx, input.professionalId, input.until, true);
    if (!p.lines.length && !p.adjustments.length) throw new UserFacingError(`Nada a pagar até ${brDate(input.until)}.`);
    const t = payoutTotals(p.lines, p.adjustments);
    if (t.netCents !== input.expectedNetCents) throw new UserFacingError(`O valor mudou desde que você abriu (agora ${formatBRL(t.netCents)}). Confira de novo.`);

    const receipt = { lines: p.lines, adjustments: p.adjustments, pending: p.pending };
    const [payout] = await tx.insert(commissionPayouts).values({
      professionalId: input.professionalId, fromDay: p.fromDay, untilDay: input.until, commissionCents: t.commissionCents, bonusCents: t.bonusCents, valesCents: t.valesCents,
      descontosCents: t.descontosCents, carriedCents: t.carriedCents, netCents: t.netCents, note, paidBy: actor.id, paidAt: now, receipt,
    }).returning({ id: commissionPayouts.id, number: commissionPayouts.number });
    // Marca só o que ainda está sem recibo e confere a contagem: linha paga por outro caminho desfaz tudo (nada é pago duas vezes).
    const changed = "O valor mudou desde que você abriu. Confira de novo.";
    const mark = async (n: number, run: () => Promise<{ id: string }[]>) => { if (n && (await run()).length !== n) throw new UserFacingError(changed); };
    const ids = (k: PayableLine["kind"]) => p.lines.filter((l) => l.kind === k).map((l) => l.id);
    await mark(ids("item").length, () => tx.update(comandaItems).set({ payoutId: payout.id })
      .where(and(inArray(comandaItems.id, ids("item")), isNull(comandaItems.payoutId))).returning({ id: comandaItems.id }));
    await mark(ids("assistente").length, () => tx.update(comandaItemAssistants).set({ payoutId: payout.id })
      .where(and(inArray(comandaItemAssistants.id, ids("assistente")), isNull(comandaItemAssistants.payoutId))).returning({ id: comandaItemAssistants.id }));
    await mark(p.adjustments.length, () => tx.update(professionalAdjustments).set({ payoutId: payout.id })
      .where(and(inArray(professionalAdjustments.id, p.adjustments.map((a) => a.id)), isNull(professionalAdjustments.payoutId))).returning({ id: professionalAdjustments.id }));

    // Saldo levado: vira desconto na comissão do dia seguinte, ligado ao recibo (desfazer o recibo cancela o saldo).
    if (t.carriedCents > 0) {
      const day = shiftDay(input.until, 1), carriedNote = `Saldo do recibo nº ${payout.number}`;
      const [a] = await tx.insert(professionalAdjustments).values({ professionalId: input.professionalId, kind: "desconto", valueCents: t.carriedCents, day, note: carriedNote,
        carriedFromPayoutId: payout.id, createdBy: actor.id, createdAt: now }).returning({ id: professionalAdjustments.id });
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "ajuste_lancado", entity: "professional_adjustment", entityId: a.id,
        data: { antes: null, depois: { profissional: p.name, kind: "desconto", valueCents: t.carriedCents, day }, motivo: carriedNote, automatico: true } });
    }
    // O recibo congelado fica na coluna `receipt` (é dele que o recibo é lido, inclusive depois de desfeito) e vai junto na auditoria.
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "comissao_paga", entity: "commission_payout", entityId: payout.id, data: {
      antes: null, depois: { numero: payout.number, profissional: p.name, de: p.fromDay, ate: input.until, ...t }, motivo: note, recibo: receipt,
    } });
    return { id: payout.id, number: payout.number, netCents: t.netCents };
  });
}

/** Desfazer o pagamento: motivo obrigatório; linhas e lançamentos voltam ao "A pagar" e o saldo levado é cancelado. Funciona com o recurso desligado. */
export async function undoPayout(id: string, input: { reason: string }, actor: Actor, now = new Date()): Promise<void> {
  const reason = (input?.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserFacingError("Escreva o motivo.");
  if (!isUuid(id)) throw new UserFacingError("Recibo não encontrado.");
  await db.transaction(async (tx) => {
    const [head] = await tx.select({ pro: commissionPayouts.professionalId }).from(commissionPayouts).where(eq(commissionPayouts.id, id));
    if (!head) throw new UserFacingError("Recibo não encontrado.");
    await lockKeyTx(tx, `repasse:${head.pro}`);
    const [p] = await tx.select().from(commissionPayouts).where(eq(commissionPayouts.id, id)).for("update");
    if (p.cancelledAt) return;
    const [carried] = await tx.select().from(professionalAdjustments)
      .where(and(eq(professionalAdjustments.carriedFromPayoutId, id), isNull(professionalAdjustments.cancelledAt))).for("update");
    if (carried?.payoutId) {
      const [later] = await tx.select({ n: commissionPayouts.number }).from(commissionPayouts).where(eq(commissionPayouts.id, carried.payoutId));
      throw new UserFacingError(`O saldo deste recibo já entrou no recibo nº ${later?.n ?? "?"}. Desfaça esse pagamento antes.`);
    }
    if (carried) await cancelTx(tx, carried.id, reason, actor.id, now);
    await tx.update(comandaItems).set({ payoutId: null }).where(eq(comandaItems.payoutId, id));
    await tx.update(comandaItemAssistants).set({ payoutId: null }).where(eq(comandaItemAssistants.payoutId, id));
    await tx.update(professionalAdjustments).set({ payoutId: null }).where(eq(professionalAdjustments.payoutId, id));
    await tx.update(commissionPayouts).set({ cancelledAt: now, cancelledBy: actor.id, cancelReason: reason }).where(eq(commissionPayouts.id, id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "comissao_pagamento_desfeito", entity: "commission_payout", entityId: id, data: {
      antes: { numero: p.number, de: p.fromDay, ate: p.untilDay, commissionCents: p.commissionCents, bonusCents: p.bonusCents, valesCents: p.valesCents,
        descontosCents: p.descontosCents, carriedCents: p.carriedCents, netCents: p.netCents },
      depois: null, motivo: reason,
    } });
  });
}

const payer = alias(users, "payer");

/** Pagas: os recibos, do mais novo para o mais antigo (inclusive os desfeitos, marcados). */
export async function listPayouts(o: { professionalId?: string; limit?: number } = {}): Promise<PayoutRow[]> {
  const rows = await db.select({ p: commissionPayouts, name: professionals.name, by: payer.name }).from(commissionPayouts)
    .innerJoin(professionals, eq(professionals.id, commissionPayouts.professionalId)).leftJoin(payer, eq(payer.id, commissionPayouts.paidBy))
    .where(o.professionalId ? eq(commissionPayouts.professionalId, o.professionalId) : undefined)
    .orderBy(desc(commissionPayouts.paidAt), desc(commissionPayouts.number)).limit(o.limit ?? 50);
  return rows.map(({ p, name, by }) => ({
    id: p.id, number: p.number, professionalId: p.professionalId, professionalName: name, fromDay: p.fromDay, untilDay: p.untilDay, netCents: p.netCents, carriedCents: p.carriedCents,
    paidAt: p.paidAt.toISOString(), paidByName: firstName(by) ?? null, cancelledAt: p.cancelledAt?.toISOString() ?? null, cancelReason: p.cancelReason,
  }));
}

/** O recibo como foi pago (lido do retrato gravado no pagamento, `commission_payouts.receipt`); null = não existe. */
export async function getPayoutReceipt(id: string): Promise<PayoutReceipt | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select({ p: commissionPayouts, name: professionals.name, by: payer.name }).from(commissionPayouts)
    .innerJoin(professionals, eq(professionals.id, commissionPayouts.professionalId)).leftJoin(payer, eq(payer.id, commissionPayouts.paidBy))
    .where(eq(commissionPayouts.id, id));
  if (!row) return null;
  const { p } = row;
  type Snap = Pick<Payable, "lines" | "adjustments" | "pending">;
  // A coluna `receipt` (0068); recibo pago antes dela: o retrato da auditoria.
  let snap = p.receipt as Snap | null;
  if (!snap) {
    const [a] = await db.select({ data: auditLog.data }).from(auditLog).where(and(eq(auditLog.action, "comissao_paga"), eq(auditLog.entityId, id))).limit(1);
    snap = (a?.data as { recibo?: Snap } | undefined)?.recibo ?? null;
  }
  return {
    id: p.id, number: p.number, professionalId: p.professionalId, name: row.name, fromDay: p.fromDay, untilDay: p.untilDay,
    lines: snap?.lines ?? [], adjustments: snap?.adjustments ?? [], pending: snap?.pending ?? [],
    totals: { commissionCents: p.commissionCents, bonusCents: p.bonusCents, valesCents: p.valesCents, descontosCents: p.descontosCents, netCents: p.netCents },
    carriedCents: p.carriedCents, paidAt: p.paidAt.toISOString(), paidByName: firstName(row.by) ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null, cancelReason: p.cancelReason, note: p.note,
  };
}

/** Decisão 11: comanda com comissão paga não reabre nem é cancelada. */
export class PaidCommissionError extends UserFacingError {}

/**
 * Recusa se alguma comissão da comanda (da principal ou de assistente) já entrou num recibo. Com `other`, a comanda é a que tinha a dívida
 * quitada pela que se quer reabrir ou cancelar (desfazer a quitação voltaria a reter uma comissão já paga). Chame com a comanda travada.
 */
export async function assertCommissionNotPaidTx(tx: Tx, c: { id: string; number: number; day: string }, other = false): Promise<void> {
  const live = and(eq(comandaItems.comandaId, c.id), isNull(comandaItems.cancelledAt));
  const [main] = await tx.select({ name: professionals.name, n: commissionPayouts.number }).from(comandaItems)
    .innerJoin(commissionPayouts, eq(commissionPayouts.id, comandaItems.payoutId)).innerJoin(professionals, eq(professionals.id, comandaItems.professionalId))
    .where(live).orderBy(asc(commissionPayouts.number)).limit(1);
  const [helper] = main ? [] : await tx.select({ name: professionals.name, n: commissionPayouts.number }).from(comandaItemAssistants)
    .innerJoin(comandaItems, eq(comandaItems.id, comandaItemAssistants.comandaItemId)).innerJoin(commissionPayouts, eq(commissionPayouts.id, comandaItemAssistants.payoutId))
    .innerJoin(professionals, eq(professionals.id, comandaItemAssistants.professionalId)).where(live).orderBy(asc(commissionPayouts.number)).limit(1);
  const hit = main ?? helper;
  if (!hit) return;
  const where = other ? `da comanda ${c.number} de ${dm(c.day)}` : "desta comanda";
  throw new PaidCommissionError(`A comissão de ${displayName(hit.name)} ${where} já foi paga no recibo nº ${hit.n}. Desfaça o pagamento em Comissão antes.`);
}
