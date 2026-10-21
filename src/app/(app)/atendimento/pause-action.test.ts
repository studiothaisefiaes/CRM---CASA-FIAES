import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as unknown[][], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/consent", () => ({ setAutomationsPaused: async (...a: unknown[]) => { calls.push(a); } }));
import { pauseAutomationsAction } from "./pause-actions";

const C = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { asked.length = 0; calls.length = 0; allowed.v = true; });

it("pede atendimento.pausar; 'sempre' pausa até religar e null religa", async () => {
  expect(await pauseAutomationsAction(C, "sempre")).toEqual({ ok: true });
  expect(await pauseAutomationsAction(C, null)).toEqual({ ok: true });
  expect(asked).toEqual(["atendimento.pausar", "atendimento.pausar"]);
  expect(calls).toEqual([[C, "sempre", "u1"], [C, null, "u1"]]);
});
it("'amanha' vira a virada do dia de Salvador (00:00, UTC-3)", async () => {
  await pauseAutomationsAction(C, "amanha");
  const until = calls[0][1] as Date;
  expect(until).toBeInstanceOf(Date);
  expect(until.getTime()).toBeGreaterThan(Date.now());
  expect(until.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
  expect(until.toISOString().slice(11)).toBe("03:00:00.000Z");
});
it("sem a permissão é recusada no servidor e nada é gravado", async () => {
  allowed.v = false;
  expect(await pauseAutomationsAction(C, "sempre")).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
it("valor inesperado é recusado", async () => {
  expect(await pauseAutomationsAction(C, "sempre" as never)).toEqual({ ok: true });
  expect(await pauseAutomationsAction("x", "sempre")).toMatchObject({ ok: false });
});
