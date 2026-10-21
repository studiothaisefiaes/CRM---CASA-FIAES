import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const { can } = await import("@/lib/permissions");
  return { assertPerm: async (p: never) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; } };
});
import { resetDb } from "../../../../../test/db";
import { setupCaixa } from "../../../../../test/caixa-fixtures";
import { getFinanceiroConfig } from "@/server/domain/financeiro/config";
import { salvarFinanceiroConfig } from "./actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); user.id = s.caixaGestao.id; user.perms = [...s.caixaGestao.perms]; });
const nova = { contasAPagar: false, resultado: false, venceEmDias: 10, repetirMaxMeses: 12 };

it("sem config.sistema, a ação é recusada no servidor e nada muda", async () => {
  user.perms = user.perms.filter((p) => p !== "config.sistema");
  expect(await salvarFinanceiroConfig(nova)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect((await getFinanceiroConfig()).contasAPagar).toBe(true);
});
it("com a permissão, grava os números novos", async () => {
  expect(await salvarFinanceiroConfig(nova)).toEqual({ ok: true });
  expect(await getFinanceiroConfig()).toEqual(nova);
});
it("número fora do limite volta com a frase do domínio", async () => {
  const r = await salvarFinanceiroConfig({ ...nova, venceEmDias: 999 });
  expect(r.ok).toBe(false);
  expect(r.ok ? "" : r.error).toContain("Vence em até");
});
