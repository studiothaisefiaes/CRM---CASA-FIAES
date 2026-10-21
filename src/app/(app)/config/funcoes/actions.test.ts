import { beforeEach, expect, it, vi } from "vitest";

const { asked, saved, allowed } = vi.hoisted(() => ({ asked: [] as string[], saved: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/funcoes", () => ({ saveFuncao: async (...a: unknown[]) => { saved.push(a); } }));
import { saveFuncaoAction } from "./actions";

beforeEach(() => { asked.length = 0; saved.length = 0; allowed.v = true; });

it("pede config.funcoes e salva com quem pediu e a confirmação", async () => {
  expect(await saveFuncaoAction("x", { on: true }, true)).toEqual({ ok: true });
  expect(asked).toEqual(["config.funcoes"]);
  expect(saved).toEqual([["x", { on: true }, "u1", { confirmouEnvio: true }]]);
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await saveFuncaoAction("x", { on: true }, true)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
});
