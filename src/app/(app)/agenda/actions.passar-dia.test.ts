import { beforeEach, expect, it, vi } from "vitest";

const { user, calls } = vi.hoisted(() => ({ user: { id: "u1", perms: [] as string[] }, calls: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: Parameters<typeof can>[1]) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check, assertAnyPerm: check, assertUser: async () => user };
});
vi.mock("@/server/domain/agenda/transfer-day", () => ({
  previewTransferDay: async (...a: unknown[]) => { calls.push(["previa", ...a]); return { movable: [], askedForHer: [], blocked: [] }; },
  transferDay: async (...a: unknown[]) => { calls.push(["passar", ...a]); return { moved: 1, skipped: [] }; },
}));
import { previewTransferDayAction, transferDayAction } from "./actions";

const NEGADO = { ok: false, error: "Você não tem permissão para isso." };
beforeEach(() => { calls.length = 0; user.perms = []; });
const A = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333", H = "44444444-4444-4444-8444-444444444444";
const base = { fromProfessionalId: A, toProfessionalId: B, day: "2026-10-16" };

it("sem agenda.passar_dia, a prévia e o passar são recusados no servidor (agenda.marcar não basta)", async () => {
  user.perms = ["agenda.marcar", "agenda.encaixar"];
  expect(await previewTransferDayAction(base)).toEqual(NEGADO);
  expect(await transferDayAction({ ...base, appointmentIds: [H], confirmAskedForHer: false })).toEqual(NEGADO);
  expect(calls).toEqual([]);
});

it("com agenda.passar_dia chega ao domínio, com quem está logada como autora", async () => {
  user.perms = ["agenda.passar_dia"];
  expect(await previewTransferDayAction(base)).toEqual({ ok: true, data: { movable: [], askedForHer: [], blocked: [] } });
  expect(await transferDayAction({ ...base, appointmentIds: [H], confirmAskedForHer: true })).toEqual({ ok: true, data: { moved: 1, skipped: [] } });
  expect(calls).toEqual([["previa", base, expect.any(Date)], ["passar", { ...base, appointmentIds: [H], confirmAskedForHer: true }, { id: "u1", perms: user.perms }, expect.any(Date)]]);
});
