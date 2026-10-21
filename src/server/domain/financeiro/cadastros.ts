import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, bankAccounts, financeCategories, settings, type BankAccount, type FinanceCategory } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { isDreExpenseGroup, type DreExpenseGroup } from "@/lib/dre";
import { PAY_METHODS, type PayMethod } from "@/lib/comanda-math";

const METHODS_KEY = "financeiro_contas_por_forma";

function assertCadastros(actor: Actor) {
  if (!can(actor.perms, "financeiro.cadastros")) throw new UserFacingError("Você não tem permissão para editar categorias e contas bancárias.");
}

export const listCategories = (): Promise<FinanceCategory[]> => db.select().from(financeCategories).orderBy(asc(financeCategories.position), asc(financeCategories.name));
export const listBankAccounts = (): Promise<BankAccount[]> => db.select().from(bankAccounts).orderBy(asc(bankAccounts.name));

export async function saveCategory(i: { id?: string; name: string; dreGroup: DreExpenseGroup; active?: boolean }, actor: Actor): Promise<{ id: string }> {
  assertCadastros(actor);
  const name = (i.name ?? "").trim();
  if (!name) throw new UserFacingError("Escreva o nome da categoria.");
  if (!isDreExpenseGroup(i.dreGroup)) throw new UserFacingError("Escolha em qual linha do Resultado a categoria entra.");
  return db.transaction(async (tx) => {
    const dup = await tx.select({ id: financeCategories.id }).from(financeCategories)
      .where(and(sql`lower(${financeCategories.name}) = lower(${name})`, i.id ? ne(financeCategories.id, i.id) : undefined));
    if (dup.length) throw new UserFacingError("Já existe uma categoria com esse nome.");
    if (i.id) {
      const [de] = await tx.select().from(financeCategories).where(eq(financeCategories.id, i.id));
      if (!de) throw new UserFacingError("Essa categoria não existe mais.");
      const para = { name, dreGroup: i.dreGroup, active: i.active ?? de.active };
      await tx.update(financeCategories).set(para).where(eq(financeCategories.id, i.id));
      await tx.insert(auditLog).values({ userId: actor.id, action: "categoria_despesa_salva", entity: "finance_categories", entityId: i.id, data: { de: { name: de.name, dreGroup: de.dreGroup, active: de.active }, para } });
      return { id: i.id };
    }
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${financeCategories.position}), 0) + 1` }).from(financeCategories);
    const [row] = await tx.insert(financeCategories).values({ name, dreGroup: i.dreGroup, active: i.active ?? true, position: next }).returning({ id: financeCategories.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "categoria_despesa_salva", entity: "finance_categories", entityId: row.id, data: { de: null, para: { name, dreGroup: i.dreGroup, active: i.active ?? true } } });
    return row;
  });
}

export async function saveBankAccount(i: { id?: string; name: string; bank?: string | null; openingCents: number; active?: boolean }, actor: Actor): Promise<{ id: string }> {
  assertCadastros(actor);
  const name = (i.name ?? "").trim();
  if (!name) throw new UserFacingError("Escreva o nome da conta.");
  if (!Number.isInteger(i.openingCents)) throw new UserFacingError("Digite o saldo inicial da conta (pode ser zero).");
  const bank = i.bank?.trim() || null;
  return db.transaction(async (tx) => {
    const dup = await tx.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(and(sql`lower(${bankAccounts.name}) = lower(${name})`, i.id ? ne(bankAccounts.id, i.id) : undefined));
    if (dup.length) throw new UserFacingError("Já existe uma conta com esse nome.");
    if (i.id) {
      const [de] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, i.id));
      if (!de) throw new UserFacingError("Essa conta não existe mais.");
      const para = { name, bank, openingCents: i.openingCents, active: i.active ?? de.active };
      await tx.update(bankAccounts).set(para).where(eq(bankAccounts.id, i.id));
      await tx.insert(auditLog).values({ userId: actor.id, action: "conta_bancaria_salva", entity: "bank_accounts", entityId: i.id, data: { de: { name: de.name, bank: de.bank, openingCents: de.openingCents, active: de.active }, para } });
      return { id: i.id };
    }
    const para = { name, bank, openingCents: i.openingCents, active: i.active ?? true };
    const [row] = await tx.insert(bankAccounts).values(para).returning({ id: bankAccounts.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "conta_bancaria_salva", entity: "bank_accounts", entityId: row.id, data: { de: null, para } });
    return row;
  });
}

/** Em qual conta bancária cai cada forma de pagamento (usado pelo extrato e pelo Resultado). */
export async function getMethodAccounts(): Promise<Partial<Record<PayMethod, string>>> {
  const [r] = await db.select().from(settings).where(eq(settings.key, METHODS_KEY));
  const v = (r?.value && typeof r.value === "object" ? r.value : {}) as Record<string, unknown>;
  const out: Partial<Record<PayMethod, string>> = {};
  for (const m of PAY_METHODS) if (typeof v[m] === "string" && v[m]) out[m] = v[m] as string;
  return out;
}

export async function saveMethodAccounts(map: Partial<Record<PayMethod, string>>, actor: Actor): Promise<void> {
  assertCadastros(actor);
  const clean: Partial<Record<PayMethod, string>> = {};
  for (const m of PAY_METHODS) if (map[m]) clean[m] = map[m];
  await db.transaction(async (tx) => {
    for (const id of Object.values(clean)) {
      const [a] = await tx.select({ active: bankAccounts.active }).from(bankAccounts).where(eq(bankAccounts.id, id as string));
      if (!a?.active) throw new UserFacingError("Escolha uma conta bancária ativa.");
    }
    const [r] = await tx.select().from(settings).where(eq(settings.key, METHODS_KEY));
    await tx.insert(settings).values({ key: METHODS_KEY, value: clean }).onConflictDoUpdate({ target: settings.key, set: { value: clean, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "conta_por_forma_salva", entity: "settings", entityId: METHODS_KEY, data: { de: r?.value ?? {}, para: clean } });
  });
}
