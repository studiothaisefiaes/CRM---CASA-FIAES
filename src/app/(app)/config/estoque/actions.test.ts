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
import { getEstoqueConfig } from "@/server/domain/estoque/config";
import { salvarEstoqueConfig } from "./actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); user.id = s.caixaGestao.id; user.perms = [...s.caixaGestao.perms]; });
const nova = { ligado: false, cfopPadrao: "5102", csosnPadrao: "500", unidadePadrao: "ml" };

it("sem config.sistema, a ação é recusada no servidor e nada muda", async () => {
  user.perms = user.perms.filter((p) => p !== "config.sistema");
  expect(await salvarEstoqueConfig(nova)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect((await getEstoqueConfig()).ligado).toBe(true);
});
it("com a permissão, grava o liga/desliga e os padrões", async () => {
  expect(await salvarEstoqueConfig(nova)).toEqual({ ok: true });
  expect(await getEstoqueConfig()).toEqual({ ...nova, unidadePadrao: "ML" });
});
it("CFOP inválido volta com a frase do domínio", async () => {
  const r = await salvarEstoqueConfig({ ...nova, cfopPadrao: "51" });
  expect(r.ok ? "" : r.error).toContain("CFOP");
});
