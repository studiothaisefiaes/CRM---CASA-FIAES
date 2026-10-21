import { beforeEach, expect, it, vi } from "vitest";

const { asked, saved, allowed } = vi.hoisted(() => ({ asked: [] as string[], saved: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/teams", () => ({ saveTeam: async (...a: unknown[]) => { saved.push(a); return { id: "t1" }; } }));
import { saveTeamAction } from "./actions";

beforeEach(() => { asked.length = 0; saved.length = 0; allowed.v = true; });

it("pede setores.gerir e salva com quem pediu", async () => {
  expect(await saveTeamAction({ name: "Recepção", memberIds: [] })).toEqual({ ok: true });
  expect(asked).toEqual(["setores.gerir"]);
  expect(saved).toEqual([[{ name: "Recepção", memberIds: [] }, "u1"]]);
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await saveTeamAction({ name: "Recepção", memberIds: [] })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
});
