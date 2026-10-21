import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/agenda/labels", () => ({
  saveAppointmentLabel: async (i: unknown) => { calls.push(i); return { id: "x" }; },
  saveVisitTypes: async (i: unknown) => { calls.push(i); },
}));
import { saveAppointmentLabelAction, saveVisitTypesAction } from "./actions";

beforeEach(() => { calls.length = 0; });

it("sem config.marcadores as duas ações são recusadas no servidor e nada é gravado", async () => {
  perms.list = ["config.diaadia", "config.sistema", "agenda.marcador"];
  expect(await saveAppointmentLabelAction({ name: "Novo" })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await saveVisitTypesAction({ noiva: { label: "Casamento" } })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(calls).toEqual([]);
});
it("com config.marcadores grava", async () => {
  perms.list = ["config.marcadores"];
  expect(await saveAppointmentLabelAction({ name: "Novo" })).toMatchObject({ ok: true, data: { id: "x" } });
  expect(await saveVisitTypesAction({ noiva: { label: "Casamento" } })).toMatchObject({ ok: true });
  expect(calls).toHaveLength(2);
});
