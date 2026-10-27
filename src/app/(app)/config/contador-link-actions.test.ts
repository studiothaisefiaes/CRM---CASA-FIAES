import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ asked: [] as string[], revoked: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { h.asked.push(p); return { id: "g1", perms: [p] }; },
  assertAnyPerm: async (...p: string[]) => { h.asked.push(p.join("|")); return { id: "g1", perms: p }; },
  assertUser: async () => ({ id: "g1", perms: [] }),
}));
vi.mock("@/server/env", async (orig) => ({ ...(await orig<typeof import("@/server/env")>()), env: () => ({ APP_URL: "https://crm.casafiaes.com.br" }) }));
vi.mock("@/server/domain/contador-link", () => ({
  createContadorLink: async () => ({ id: "l1", token: "segredo-do-link", expiresAt: new Date("2026-11-02T12:00:00Z") }),
  revokeContadorLink: async (id: string) => { h.revoked.push(id); },
}));
import { createContadorLinkAction, revokeContadorLinkAction } from "./actions";

beforeEach(() => { h.asked = []; h.revoked = []; });

it("gerar o link do contador pede equipe.gerir e devolve o endereço público /convite/<token> (mostrado uma vez só)", async () => {
  expect(await createContadorLinkAction()).toEqual({ ok: true, data: { id: "l1", url: "https://crm.casafiaes.com.br/convite/segredo-do-link", expiresAt: "2026-11-02T12:00:00.000Z" } });
  expect(h.asked).toEqual(["equipe.gerir"]);
});

it("revogar o link pede equipe.gerir", async () => {
  expect(await revokeContadorLinkAction("l1")).toEqual({ ok: true });
  expect(h.asked).toEqual(["equipe.gerir"]);
  expect(h.revoked).toEqual(["l1"]);
});
