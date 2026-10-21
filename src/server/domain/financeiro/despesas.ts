import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, bankAccounts, expenses, financeCategories, type Expense } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can, type Perm } from "@/lib/permissions";
import { todayBahia } from "@/lib/agenda";
import { expenseStatus, monthlyDueDates, type ExpenseStatus } from "@/lib/expense-status";
import { PAY_METHODS, type PayMethod } from "@/lib/comanda-math";
import { assertContasAPagarOn, getFinanceiroConfig } from "./config";

export type ExpenseInput = {
  title: string; categoryId: string; supplier?: string | null; amountCents: number; dueOn: string; competence?: string | null;
  repeatMonths?: number; bankAccountId?: string | null; notes?: string | null;
};
export type ExpensePayMethod = PayMethod | "boleto" | "transferencia";
export type ExpenseRow = Expense & { categoryName: string; status: ExpenseStatus };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function need(actor: Actor, perm: Perm, what: string) {
  if (!can(actor.perms, perm)) throw new UserFacingError(`Você não tem permissão para ${what}.`);
}

export async function createExpense(i: ExpenseInput, actor: Actor): Promise<{ ids: string[] }> {
  need(actor, "financeiro.lancar", "lançar despesas");
  const cfg = await assertContasAPagarOn();
  const title = (i.title ?? "").trim();
  if (!title) throw new UserFacingError("Escreva o que é a despesa.");
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new UserFacingError("Digite o valor da despesa.");
  if (!validDay(i.dueOn)) throw new UserFacingError("Escolha o dia do vencimento.");
  const n = i.repeatMonths ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > cfg.repetirMaxMeses) throw new UserFacingError(`Repita de 1 a ${cfg.repetirMaxMeses} meses.`);
  if (i.competence != null && !validDay(i.competence)) throw new UserFacingError("Escolha o mês a que a despesa pertence.");
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(financeCategories).where(eq(financeCategories.id, i.categoryId ?? ""));
    if (!cat?.active) throw new UserFacingError("Escolha uma categoria ativa.");
    if (i.bankAccountId) {
      const [a] = await tx.select({ active: bankAccounts.active }).from(bankAccounts).where(eq(bankAccounts.id, i.bankAccountId));
      if (!a?.active) throw new UserFacingError("Escolha uma conta bancária ativa.");
    }
    const dues = monthlyDueDates(i.dueOn, n);
    const seriesId = n > 1 ? randomUUID() : null;
    const rows = dues.map((dueOn, k) => ({
      title, categoryId: cat.id, supplier: i.supplier?.trim() || null, amountCents: i.amountCents, dueOn,
      // Competência informada vale para a 1ª parcela; as seguintes seguem o mês de cada vencimento.
      competence: k === 0 && i.competence ? `${i.competence.slice(0, 7)}-01` : `${dueOn.slice(0, 7)}-01`,
      bankAccountId: i.bankAccountId || null, seriesId, installment: k + 1, installments: n, notes: i.notes?.trim() || null, createdBy: actor.id,
    }));
    const ids = (await tx.insert(expenses).values(rows).returning({ id: expenses.id, dueOn: expenses.dueOn })).sort((a, b) => a.dueOn.localeCompare(b.dueOn)).map((r) => r.id);
    await tx.insert(auditLog).values({ userId: actor.id, action: "despesa_lancada", entity: "expenses", entityId: ids[0], data: { de: null, para: { title, categoryId: cat.id, amountCents: i.amountCents, dueOn: i.dueOn, repeatMonths: n, seriesId } } });
    return { ids };
  });
}

export async function payExpense(id: string, p: { paidOn: string; paidCents: number; bankAccountId: string | null; method: ExpensePayMethod }, actor: Actor): Promise<void> {
  need(actor, "financeiro.pagar", "pagar despesas");
  await assertContasAPagarOn();
  if (!validDay(p.paidOn)) throw new UserFacingError("Escolha o dia do pagamento.");
  if (!Number.isInteger(p.paidCents) || p.paidCents <= 0) throw new UserFacingError("Digite o valor pago.");
  if (!([...PAY_METHODS, "boleto", "transferencia"] as string[]).includes(p.method)) throw new UserFacingError("Escolha a forma de pagamento.");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e || e.cancelledAt) throw new UserFacingError("Essa despesa não existe mais ou foi cancelada.");
    if (e.paidOn) throw new UserFacingError("Essa despesa já está paga.");
    if (p.bankAccountId) {
      const [a] = await tx.select({ active: bankAccounts.active }).from(bankAccounts).where(eq(bankAccounts.id, p.bankAccountId));
      if (!a?.active) throw new UserFacingError("Escolha uma conta bancária ativa.");
    }
    await tx.update(expenses).set({ paidOn: p.paidOn, paidCents: p.paidCents, bankAccountId: p.bankAccountId, paidMethod: p.method }).where(eq(expenses.id, id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "despesa_paga", entity: "expenses", entityId: id, data: { de: { paidOn: null }, para: { paidOn: p.paidOn, paidCents: p.paidCents, bankAccountId: p.bankAccountId, method: p.method } } });
  });
}

export async function undoExpensePayment(id: string, actor: Actor): Promise<void> {
  need(actor, "financeiro.pagar", "desfazer o pagamento de despesas");
  await assertContasAPagarOn();
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e || e.cancelledAt) throw new UserFacingError("Essa despesa não existe mais ou foi cancelada.");
    if (!e.paidOn) throw new UserFacingError("Essa despesa ainda não foi paga.");
    await tx.update(expenses).set({ paidOn: null, paidCents: null, paidMethod: null }).where(eq(expenses.id, id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "despesa_pagamento_desfeito", entity: "expenses", entityId: id, data: { de: { paidOn: e.paidOn, paidCents: e.paidCents, bankAccountId: e.bankAccountId, method: e.paidMethod }, para: { paidOn: null } } });
  });
}

/** "esta" cancela só a parcela; "proximas" cancela também as seguintes da série que ainda não foram pagas. */
export async function cancelExpense(id: string, c: { reason: string; scope: "esta" | "proximas" }, actor: Actor): Promise<void> {
  need(actor, "financeiro.cancelar", "cancelar despesas");
  await assertContasAPagarOn();
  const reason = (c.reason ?? "").trim();
  if (!reason) throw new UserFacingError("Escreva o motivo do cancelamento.");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!e || e.cancelledAt) throw new UserFacingError("Essa despesa não existe mais ou já foi cancelada.");
    if (e.paidOn) throw new UserFacingError("Essa despesa já foi paga. Desfaça o pagamento antes de cancelar.");
    const targets = c.scope === "proximas" && e.seriesId
      ? await tx.select({ id: expenses.id, installment: expenses.installment }).from(expenses)
          .where(and(eq(expenses.seriesId, e.seriesId), gte(expenses.installment, e.installment), isNull(expenses.cancelledAt), isNull(expenses.paidOn)))
      : [{ id: e.id, installment: e.installment }];
    const ids = targets.map((t) => t.id);
    await tx.update(expenses).set({ cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: reason }).where(inArray(expenses.id, ids));
    await tx.insert(auditLog).values({ userId: actor.id, action: "despesa_cancelada", entity: "expenses", entityId: id, data: { de: { cancelled: false }, para: { cancelled: true, reason, scope: c.scope, ids } } });
  });
}

/** Despesas com vencimento no período, fora as canceladas, por vencimento e título. Não recusa quando Contas a pagar está desligado (a tela decide). */
export async function listExpenses(f: { from: string; to: string; status?: ExpenseStatus; categoryId?: string }, now: Date): Promise<ExpenseRow[]> {
  const cfg = await getFinanceiroConfig();
  const today = todayBahia(now);
  const rows = await db.select({ e: expenses, categoryName: financeCategories.name }).from(expenses)
    .innerJoin(financeCategories, eq(financeCategories.id, expenses.categoryId))
    .where(and(gte(expenses.dueOn, f.from), lte(expenses.dueOn, f.to), isNull(expenses.cancelledAt), f.categoryId ? eq(expenses.categoryId, f.categoryId) : undefined))
    .orderBy(asc(expenses.dueOn), asc(expenses.title), asc(expenses.installment));
  return rows.map((r) => ({ ...r.e, categoryName: r.categoryName, status: expenseStatus(r.e, today, cfg.venceEmDias) })).filter((r) => !f.status || r.status === f.status);
}
