import { beforeEach, expect, it, vi } from "vitest";

const { user, calls } = vi.hoisted(() => ({ user: { id: "u1", perms: [] as string[] }, calls: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: Parameters<typeof can>[1]) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check, assertAnyPerm: check, assertUser: async () => user };
});
vi.mock("@/server/domain/agenda/recurrence", () => ({
  createRecurringVisits: async (...a: unknown[]) => { calls.push(["repetir", ...a]); return { seriesId: "s1", created: [{ day: "2026-10-16", visitId: "v1" }], skipped: [] }; },
  saveRepetirConfig: async (...a: unknown[]) => { calls.push(["config", ...a]); return a[0]; },
}));
import { createRecurringVisitsAction } from "./actions";
import { saveRepetirConfigAction } from "../config/actions";

const NEGADO = { ok: false, error: "Você não tem permissão para isso." };
beforeEach(() => { calls.length = 0; user.perms = []; });
const input = {
  requestKey: "22222222-2222-4222-8222-222222222222", client: { contactId: "33333333-3333-4333-8333-333333333333" }, startsAt: "2026-10-16T13:00:00.000Z",
  items: [{ serviceId: "44444444-4444-4444-8444-444444444444", professionalId: null, preference: "sem_preferencia" as const }], repeat: { everyWeeks: 2, times: 4 },
};

it("sem agenda.repetir, marcar repetido é recusado no servidor (agenda.marcar não basta); com as duas chega ao domínio", async () => {
  user.perms = ["agenda.marcar"];
  expect(await createRecurringVisitsAction(input)).toEqual(NEGADO);
  user.perms = ["agenda.repetir"];
  expect(await createRecurringVisitsAction(input)).toEqual(NEGADO);
  expect(calls).toEqual([]);
  user.perms = ["agenda.marcar", "agenda.repetir"];
  expect(await createRecurringVisitsAction(input)).toEqual({ ok: true, data: { seriesId: "s1", created: [{ day: "2026-10-16", visitId: "v1" }], skipped: [] } });
  expect(calls).toEqual([["repetir", input, { id: "u1", perms: user.perms }]]);
});

it("repetido também pede a preferência e, com marcador, agenda.marcador", async () => {
  user.perms = ["agenda.marcar", "agenda.repetir"];
  expect(await createRecurringVisitsAction({ ...input, items: [{ serviceId: input.items[0].serviceId, professionalId: null }] })).toEqual({ ok: false, error: "Diga se ela quer uma profissional ou tanto faz." });
  expect(await createRecurringVisitsAction({ ...input, visitType: "noiva" })).toEqual(NEGADO);
  expect(calls).toEqual([]);
});

it("os limites do Repetir em Configurações pedem config.sistema", async () => {
  user.perms = ["config.diaadia", "config.marcadores", "agenda.repetir"];
  expect(await saveRepetirConfigAction({ maxSemanas: 12, maxVezes: 30 })).toEqual(NEGADO);
  user.perms = ["config.sistema"];
  expect(await saveRepetirConfigAction({ maxSemanas: 12, maxVezes: 30 })).toEqual({ ok: true, data: { maxSemanas: 12, maxVezes: 30 } });
  expect(calls).toEqual([["config", { maxSemanas: 12, maxVezes: 30 }, "u1"]]);
});
