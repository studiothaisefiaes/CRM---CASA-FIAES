import { beforeEach, expect, it, vi } from "vitest";

const { asked, passed, allowed } = vi.hoisted(() => ({ asked: [] as string[], passed: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/deal-scope", () => ({ assertCanActOnDeal: async () => {} }));
vi.mock("@/server/domain/teams", () => ({ passToTeam: async (...a: unknown[]) => { passed.push(a); return { ownerId: null }; } }));
import { passToTeamAction } from "./actions";

const D = "00000000-0000-4000-8000-000000000001", T = "00000000-0000-4000-8000-000000000002";
beforeEach(() => { asked.length = 0; passed.length = 0; allowed.v = true; });

it("pede atendimento.setor e passa para o setor com quem pediu", async () => {
  expect(await passToTeamAction(D, T)).toEqual({ ok: true, data: { ownerId: null } });
  expect(asked).toEqual(["atendimento.setor"]);
  expect(passed).toEqual([[D, T, "u1"]]);
});
it("sem a permissão é recusada no servidor e nada é passado", async () => {
  allowed.v = false;
  expect(await passToTeamAction(D, T)).toMatchObject({ ok: false });
  expect(passed).toEqual([]);
});
