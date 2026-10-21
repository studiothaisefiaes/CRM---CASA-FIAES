import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/fidelidade", () => ({ redeemLoyalty: async (...a: unknown[]) => { calls.push(a); return { itemId: "i1" }; } }));
import { redeemLoyaltyAction } from "./actions";

const C = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222", I = "33333333-3333-4333-8333-333333333333";
beforeEach(() => { calls.length = 0; });

it("sem fidelidade.resgatar a action é recusada no servidor (caixa.operar não basta) e nada é gravado", async () => {
  perms.list = ["caixa.operar"];
  expect(await redeemLoyaltyAction(C, P, { itemId: I })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(calls).toEqual([]);
});
it("sem caixa.operar também é recusada", async () => {
  perms.list = ["fidelidade.resgatar"];
  expect(await redeemLoyaltyAction(C, P, { itemId: I })).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
it("com as duas permissões usa o prêmio", async () => {
  perms.list = ["caixa.operar", "fidelidade.resgatar"];
  expect(await redeemLoyaltyAction(C, P, { itemId: I })).toEqual({ ok: true, data: { itemId: "i1" } });
  expect(calls).toHaveLength(1);
});
