import { beforeEach, expect, it, vi } from "vitest";

const { asked, saved, allowed } = vi.hoisted(() => ({ asked: [] as string[], saved: [] as unknown[][], allowed: { v: true, virada: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v || (p === "virada.fazer" && !allowed.virada)) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/after-visit", () => ({ saveAfterVisit: async (...a: unknown[]) => { saved.push(a); } }));
import { saveAfterVisitAction } from "./actions";

beforeEach(() => { asked.length = 0; saved.length = 0; allowed.v = true; allowed.virada = true; });

it("pede config.sistema e salva com quem pediu", async () => {
  expect(await saveAfterVisitAction({ mode: "desligado" })).toEqual({ ok: true });
  expect(asked).toEqual(["config.sistema"]);
  expect(saved).toEqual([[{ mode: "desligado" }, "u1"]]);
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await saveAfterVisitAction({ mode: "desligado" })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
});
it("salvar ligado (modo diferente de Nada) também pede virada.fazer; sem ela é recusado e nada é gravado", async () => {
  expect(await saveAfterVisitAction({ mode: "agradecimento" })).toEqual({ ok: true });
  expect(asked).toEqual(["config.sistema", "virada.fazer"]);
  allowed.virada = false;
  saved.length = 0;
  expect(await saveAfterVisitAction({ mode: "pesquisa" })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
  expect(await saveAfterVisitAction({ mode: "desligado" })).toEqual({ ok: true });
});
