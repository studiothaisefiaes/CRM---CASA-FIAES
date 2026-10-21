import { beforeEach, expect, it, vi } from "vitest";

const { asked, saved, allowed } = vi.hoisted(() => ({ asked: [] as string[], saved: [] as unknown[][], allowed: { perms: new Set<string>() } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.perms.has(p)) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/client-link/reminder", () => ({ saveLembreteD1: async (...a: unknown[]) => { saved.push(a); } }));
import { saveLembreteD1Action } from "./lembrete-actions";

beforeEach(() => { asked.length = 0; saved.length = 0; allowed.perms = new Set(["config.sistema"]); });

it("desligado: pede config.sistema e salva", async () => {
  expect(await saveLembreteD1Action({ enabled: false })).toMatchObject({ ok: true });
  expect(asked).toEqual(["config.sistema"]);
  expect(saved).toEqual([[{ enabled: false }, "u1"]]);
});

it("ligado (Task 10): também pede virada.fazer; sem ela é recusado no servidor e nada é gravado", async () => {
  expect(await saveLembreteD1Action({ enabled: true })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
  allowed.perms.add("virada.fazer");
  expect(await saveLembreteD1Action({ enabled: true })).toMatchObject({ ok: true });
  expect(saved).toEqual([[{ enabled: true }, "u1"]]);
});
