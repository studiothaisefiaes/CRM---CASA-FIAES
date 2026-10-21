import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const user = vi.hoisted(() => ({ id: "", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const { can } = await import("@/lib/permissions");
  return {
    assertUser: async () => user,
    assertPerm: async (p: never) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; },
  };
});
import { db } from "@/server/db";
import { expenses } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { saveFinanceiroConfig } from "@/server/domain/financeiro/config";
import { DEFAULT_FINANCEIRO_CONFIG } from "@/lib/financeiro-settings";
import { cancelarDespesa, desfazerPagamento, lancarDespesa, pagarDespesa, salvarCategoria, salvarConta, salvarContaPorForma } from "./financeiro-actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const as = (...drop: string[]) => { user.id = s.caixaGestao.id; user.perms = s.caixaGestao.perms.filter((p) => !drop.includes(p)); };
const OFF = "Contas a pagar está desligado em Configurações › Financeiro.";
const NO = "Você não tem permissão para isso.";

beforeEach(async () => { await resetDb(); s = await setupCaixa(); as(); });

async function umaDespesa() {
  const c = await salvarCategoria({ name: "Aluguel", dreGroup: "ocupacao" });
  if (!c.ok) throw new Error(c.error);
  const r = await lancarDespesa({ title: "Aluguel", categoryId: (c.data as { id: string }).id, amountCents: 100000, dueOn: "2026-10-31" });
  if (!r.ok) throw new Error(r.error);
  return (r.data as { ids: string[] }).ids[0];
}

describe("cada ação confere a própria permissão no servidor", () => {
  it("sem financeiro.lancar, não lança", async () => {
    const c = await salvarCategoria({ name: "Aluguel", dreGroup: "ocupacao" });
    if (!c.ok) throw new Error(c.error);
    as("financeiro.lancar");
    const r = await lancarDespesa({ title: "X", categoryId: (c.data as { id: string }).id, amountCents: 100, dueOn: "2026-10-31" });
    expect(r.ok).toBe(false);
    expect(await db.select().from(expenses)).toHaveLength(0);
  });
  it("sem financeiro.pagar, não paga nem desfaz; sem financeiro.cancelar, não cancela", async () => {
    const id = await umaDespesa();
    as("financeiro.pagar");
    expect((await pagarDespesa(id, { paidOn: "2026-10-18", paidCents: 100000, bankAccountId: null, method: "pix" })).ok).toBe(false);
    expect((await desfazerPagamento(id)).ok).toBe(false);
    as("financeiro.cancelar");
    expect((await cancelarDespesa(id, { reason: "Engano", scope: "esta" })).ok).toBe(false);
    const [e] = await db.select().from(expenses).where(eq(expenses.id, id));
    expect(e.paidOn).toBeNull(); expect(e.cancelledAt).toBeNull();
  });
  it("sem financeiro.cadastros, não mexe em categorias, contas nem na conta por forma", async () => {
    as("financeiro.cadastros");
    expect(await salvarCategoria({ name: "Luz", dreGroup: "ocupacao" })).toEqual({ ok: false, error: NO });
    expect(await salvarConta({ name: "Itaú", openingCents: 0 })).toEqual({ ok: false, error: NO });
    expect(await salvarContaPorForma({ pix: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: NO });
  });
});

describe("liga/desliga e frase do domínio", () => {
  it("lança, paga, desfaz e cancela quando tudo está ligado", async () => {
    const id = await umaDespesa();
    expect((await pagarDespesa(id, { paidOn: "2026-10-18", paidCents: 100000, bankAccountId: null, method: "pix" })).ok).toBe(true);
    expect(await cancelarDespesa(id, { reason: "Engano", scope: "esta" })).toEqual({ ok: false, error: "Essa despesa já foi paga. Desfaça o pagamento antes de cancelar." });
    expect((await desfazerPagamento(id)).ok).toBe(true);
    expect((await cancelarDespesa(id, { reason: "Engano", scope: "esta" })).ok).toBe(true);
  });
  it("com Contas a pagar desligado, as escritas são recusadas", async () => {
    const id = await umaDespesa();
    await saveFinanceiroConfig({ ...DEFAULT_FINANCEIRO_CONFIG, contasAPagar: false }, s.caixaGestao);
    const c = await salvarCategoria({ name: "Luz", dreGroup: "ocupacao" });
    if (!c.ok) throw new Error(c.error);
    expect(await lancarDespesa({ title: "Luz", categoryId: (c.data as { id: string }).id, amountCents: 100, dueOn: "2026-10-31" })).toEqual({ ok: false, error: OFF });
    expect(await pagarDespesa(id, { paidOn: "2026-10-18", paidCents: 100000, bankAccountId: null, method: "pix" })).toEqual({ ok: false, error: OFF });
  });
  it("entrada torta vira frase, não erro cru", async () => {
    const r = await lancarDespesa({ title: "", categoryId: "nao-e-uuid", amountCents: 100, dueOn: "2026-10-31" });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/\S/);
  });
});
