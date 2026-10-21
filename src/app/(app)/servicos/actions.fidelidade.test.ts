import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/fidelidade-programas", () => ({
  saveLoyaltyProgram: async (i: unknown) => { calls.push(i); return { id: "x" }; },
  saveAvecLoyaltyProgram: async (i: unknown) => { calls.push(i); },
}));
import { saveAvecLoyaltyProgramAction, saveLoyaltyProgramAction } from "./actions";

const INPUT = { name: "Fiel", goal: 12, rewardServiceIds: [], rewardDiscountBp: 10000, countsPackageSessions: false, rewardReasonTemplate: "", active: true };
beforeEach(() => { calls.length = 0; });

it("sem fidelidade.programas as duas ações são recusadas no servidor (servicos.editar não basta) e nada é gravado", async () => {
  perms.list = ["servicos.editar", "fidelidade.resgatar", "caixa.operar"];
  expect(await saveLoyaltyProgramAction(INPUT)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await saveAvecLoyaltyProgramAction(null)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(calls).toEqual([]);
});
it("com fidelidade.programas grava", async () => {
  perms.list = ["fidelidade.programas"];
  expect(await saveLoyaltyProgramAction(INPUT)).toMatchObject({ ok: true, data: { id: "x" } });
  expect(await saveAvecLoyaltyProgramAction("11111111-1111-4111-8111-111111111111")).toMatchObject({ ok: true });
  expect(calls).toHaveLength(2);
});
