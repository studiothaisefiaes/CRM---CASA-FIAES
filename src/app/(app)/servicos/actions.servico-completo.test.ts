import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/services", () => ({
  createService: async (...a: unknown[]) => { calls.push(["criar", ...a]); return { id: "x" }; },
  updateService: async (...a: unknown[]) => { calls.push(["editar", ...a]); },
}));
vi.mock("@/server/domain/professionals", () => ({
  setProfessionalServiceTerms: async (...a: unknown[]) => { calls.push(["valores", ...a]); },
}));
import { createServiceAction, setProServiceTermsAction, updateServiceAction } from "./actions";

const SVC = "11111111-1111-4111-8111-111111111111", PRO = "22222222-2222-4222-8222-222222222222";
const NEGADO = { ok: false, error: "Você não tem permissão para isso." };
beforeEach(() => { calls.length = 0; });

it("custo: sem servicos.custo é recusado no servidor (servicos.editar não basta), ao criar e ao editar", async () => {
  perms.list = ["servicos.editar"];
  expect(await updateServiceAction(SVC, { costCents: 4000 })).toEqual(NEGADO);
  expect(await updateServiceAction(SVC, { priceCents: 9000, costCents: 4000 })).toEqual(NEGADO);
  expect(await createServiceAction({ label: "Luzes", costCents: 4000 })).toEqual(NEGADO);
  expect(calls).toEqual([]);
  // Sem o custo no pedido, servicos.editar basta (tipo de preço e "junto com outro" seguem servicos.editar).
  expect(await updateServiceAction(SVC, { priceKind: "a_partir_de", parallelOk: true })).toEqual({ ok: true });
  expect(calls).toEqual([["editar", SVC, { priceKind: "a_partir_de", parallelOk: true }, "u1"]]);
});

it("custo: com servicos.custo muda só o custo (sem servicos.editar); o resto ainda pede servicos.editar", async () => {
  perms.list = ["servicos.custo"];
  expect(await updateServiceAction(SVC, { costCents: 4000 })).toEqual({ ok: true });
  expect(await updateServiceAction(SVC, { costCents: 4000, priceCents: 9000 })).toEqual(NEGADO);
  perms.list = ["servicos.custo", "servicos.editar"];
  expect(await createServiceAction({ label: "Luzes", costCents: 4000 })).toMatchObject({ ok: true });
  expect(calls).toEqual([["editar", SVC, { costCents: 4000 }, "u1"], ["criar", { label: "Luzes", costCents: 4000 }, "u1"]]);
});

it("preço e tempo por profissional: sem servicos.por_profissional é recusado (servicos.editar não basta); com ela grava", async () => {
  perms.list = ["servicos.editar", "servicos.custo"];
  expect(await setProServiceTermsAction(PRO, SVC, { priceCents: 30000, durationMin: 150 })).toEqual(NEGADO);
  expect(calls).toEqual([]);
  perms.list = ["servicos.por_profissional"];
  expect(await setProServiceTermsAction(PRO, SVC, { priceCents: 30000, durationMin: null })).toEqual({ ok: true });
  expect(calls).toEqual([["valores", PRO, SVC, { priceCents: 30000, durationMin: null }, "u1"]]);
  expect(await setProServiceTermsAction("x", SVC, {})).toEqual({ ok: false, error: "Confira os campos e tente de novo." });
});
