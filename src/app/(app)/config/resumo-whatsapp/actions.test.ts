import { beforeEach, expect, it, vi } from "vitest";

const { asked, saved, allowed } = vi.hoisted(() => ({ asked: [] as string[], saved: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/summary-whatsapp", () => ({ saveSummaryWhatsapp: async (...a: unknown[]) => { saved.push(a); } }));
import { saveSummaryWhatsappAction } from "./actions";

beforeEach(() => { asked.length = 0; saved.length = 0; allowed.v = true; });

it("pede config.sistema e salva com quem pediu e a confirmação de envio real", async () => {
  expect(await saveSummaryWhatsappAction({ enabled: true }, true)).toEqual({ ok: true, descartadas: 0 });
  expect(asked).toEqual(["config.sistema"]);
  expect(saved).toEqual([[{ enabled: true }, "u1", { confirmouEnvio: true }]]);
});
it("sem a confirmação, o servidor recebe confirmouEnvio falso", async () => {
  await saveSummaryWhatsappAction({ enabled: true });
  expect(saved[0][2]).toEqual({ confirmouEnvio: false });
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await saveSummaryWhatsappAction({ enabled: false })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(saved).toEqual([]);
});
