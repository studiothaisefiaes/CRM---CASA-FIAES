import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/client-alert", () => ({ saveClientAlertConfig: async (i: unknown) => { calls.push(i); } }));
import { saveClientAlertAction } from "./actions";

beforeEach(() => { calls.length = 0; });

it("sem config.aviso_cliente a ação é recusada no servidor e nada é gravado", async () => {
  perms.list = ["config.diaadia", "config.sistema", "agenda.marcar"];
  expect(await saveClientAlertAction({ noHorario: false })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(calls).toEqual([]);
});
it("com config.aviso_cliente grava", async () => {
  perms.list = ["config.aviso_cliente"];
  expect(await saveClientAlertAction({ noHorario: false })).toMatchObject({ ok: true });
  expect(calls).toEqual([{ noHorario: false }]);
});
