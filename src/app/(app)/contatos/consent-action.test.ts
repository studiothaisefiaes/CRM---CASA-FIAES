import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/consent", () => ({ saveConsent: async (...a: unknown[]) => { calls.push(a); } }));
import { saveConsentAction } from "./consent-actions";

const C = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { asked.length = 0; calls.length = 0; allowed.v = true; });

it("pede cliente.consentimento e grava a resposta com quem pediu", async () => {
  expect(await saveConsentAction(C, { whatsapp: false })).toEqual({ ok: true });
  expect(asked).toEqual(["cliente.consentimento"]);
  expect(calls).toEqual([[C, { whatsapp: false }, "u1"]]);
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await saveConsentAction(C, { ai: false })).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
it("campo desconhecido ou valor que não é Sim/Não/null é recusado", async () => {
  expect(await saveConsentAction(C, { outro: true })).toMatchObject({ ok: false });
  expect(await saveConsentAction(C, { ai: "talvez" })).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
