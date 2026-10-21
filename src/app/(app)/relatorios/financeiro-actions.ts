"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import type { SessionUser } from "@/server/auth/sessions-store";
import type { Perm } from "@/lib/permissions";
import { PAY_METHODS } from "@/lib/comanda-math";
import { DRE_EXPENSE_GROUPS } from "@/lib/dre";
import { userErrorMessage } from "@/server/user-error";
import { cancelExpense, createExpense, payExpense, undoExpensePayment } from "@/server/domain/financeiro/despesas";
import { saveBankAccount, saveCategory, saveMethodAccounts } from "@/server/domain/financeiro/cadastros";

export type FinanceActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const actorOf = (u: SessionUser) => ({ id: u.id, perms: u.perms });
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(2_000_000_000);
const PAY = [...PAY_METHODS, "boleto", "transferencia"] as [string, ...string[]];

/** Cada ação pede a SUA permissão aqui e o domínio confere de novo; o texto do domínio chega à tela, o resto vira "Não deu certo". */
async function run<T>(perm: Perm, fn: (u: SessionUser) => Promise<T>): Promise<FinanceActionResult<T>> {
  try {
    const data = await fn(await assertPerm(perm));
    revalidatePath("/relatorios");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e, "financeiro", "Não deu certo. Tente de novo.") };
  }
}

export const lancarDespesa = async (input: { title: string; categoryId: string; supplier?: string | null; amountCents: number; dueOn: string; repeatMonths?: number; bankAccountId?: string | null; notes?: string | null }) =>
  run("financeiro.lancar", (u) => createExpense(z.object({
    title: z.string().max(200), categoryId: uuid, supplier: z.string().max(200).nullish(), amountCents: cents, dueOn: day,
    repeatMonths: z.number().int().optional(), bankAccountId: uuid.nullish(), notes: z.string().max(1000).nullish(),
  }).parse(input), actorOf(u)));

export const pagarDespesa = async (id: string, input: { paidOn: string; paidCents: number; bankAccountId: string | null; method: string }) =>
  run("financeiro.pagar", (u) => {
    const p = z.object({ paidOn: day, paidCents: cents, bankAccountId: uuid.nullable(), method: z.enum(PAY) }).parse(input);
    return payExpense(uuid.parse(id), p as Parameters<typeof payExpense>[1], actorOf(u));
  });

export const desfazerPagamento = async (id: string) => run("financeiro.pagar", (u) => undoExpensePayment(uuid.parse(id), actorOf(u)));

export const cancelarDespesa = async (id: string, input: { reason: string; scope: "esta" | "proximas" }) =>
  run("financeiro.cancelar", (u) => cancelExpense(uuid.parse(id), z.object({ reason: z.string().max(500), scope: z.enum(["esta", "proximas"]) }).parse(input), actorOf(u)));

export const salvarCategoria = async (input: { id?: string; name: string; dreGroup: string; active?: boolean }) =>
  run("financeiro.cadastros", (u) => saveCategory(z.object({ id: uuid.optional(), name: z.string().max(120), dreGroup: z.enum(DRE_EXPENSE_GROUPS), active: z.boolean().optional() }).parse(input), actorOf(u)));

export const salvarConta = async (input: { id?: string; name: string; bank?: string | null; openingCents: number; active?: boolean }) =>
  run("financeiro.cadastros", (u) => saveBankAccount(z.object({ id: uuid.optional(), name: z.string().max(120), bank: z.string().max(120).nullish(), openingCents: z.number().int(), active: z.boolean().optional() }).parse(input), actorOf(u)));

export const salvarContaPorForma = async (map: Partial<Record<(typeof PAY_METHODS)[number], string>>) =>
  run("financeiro.cadastros", (u) => saveMethodAccounts(z.record(z.enum(PAY_METHODS), uuid).parse(map), actorOf(u)));
