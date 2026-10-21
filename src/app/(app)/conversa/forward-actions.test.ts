import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as string[], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/deal-scope", () => ({ assertCanActOnDeal: async () => {}, assertCanActOnMessage: async () => {}, assertCanActOnOutbox: async () => {} }));
vi.mock("@/server/domain/forward", () => ({ forwardMessage: async () => { calls.push("forward"); return { sent: 1, failed: [] }; } }));
vi.mock("@/server/queries/forward-targets", () => ({ forwardTargets: async () => { calls.push("targets"); return []; } }));
import { forwardAction, forwardTargetsAction } from "./actions";

const U = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { asked.length = 0; calls.length = 0; allowed.v = true; });

it("encaminhar e buscar destinos pedem mensagem.encaminhar", async () => {
  expect(await forwardAction(U, [U])).toMatchObject({ ok: true, data: { sent: 1 } });
  expect(await forwardTargetsAction("a", null)).toMatchObject({ ok: true });
  expect(asked).toEqual(["mensagem.encaminhar", "mensagem.encaminhar"]);
});
it("sem a permissão é recusado no servidor e nada é feito", async () => {
  allowed.v = false;
  expect(await forwardAction(U, [U])).toMatchObject({ ok: false });
  expect(await forwardTargetsAction("a", null)).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
