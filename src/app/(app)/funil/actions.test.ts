import { it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({ assertUser: async () => ({ id: "u1", role: "gestor" }) }));
vi.mock("@/server/domain/updates", async (orig) => ({
  ...(await orig<typeof import("@/server/domain/updates")>()),
  updateDeal: async () => { class DrizzleQueryError extends Error {} throw new DrizzleQueryError('Failed query: update "deals" set "value_cents" = $1 where "deals"."id" = $2'); },
}));
import { updateDealAction } from "./actions";

it("SQL do drizzle não chega à tela do lead: texto genérico", async () => {
  const o = console.error; const errs: unknown[] = []; console.error = (...a: unknown[]) => { errs.push(a); };
  let r;
  try { r = await updateDealAction("00000000-0000-4000-8000-000000000000", { observations: "x" }); } finally { console.error = o; }
  expect(r).toEqual({ ok: false, error: "Não deu certo. Tente de novo." });
  expect(errs.length).toBe(1); // e o erro vai para o log
});
