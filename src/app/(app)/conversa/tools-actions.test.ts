import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as string[], allowed: { v: true } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/deal-scope", () => ({ assertCanActOnDeal: async () => {}, assertCanActOnMessage: async () => {}, assertCanActOnOutbox: async () => {} }));
vi.mock("@/server/domain/deals", async (orig) => ({ ...(await orig<object>()), waitedBusinessSeconds: async () => null }));
vi.mock("@/server/domain/message-tools", () => ({
  reactToMessage: async () => { calls.push("react"); }, editSentMessage: async () => { calls.push("edit"); },
  sendCasaLocation: async () => { calls.push("location"); }, sendContactCard: async () => { calls.push("contact"); },
}));
import { editMessageAction, reactAction, sendContactAction, sendLocationAction } from "./actions";

const U = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { asked.length = 0; calls.length = 0; allowed.v = true; });

it("cada ação pede a sua permissão", async () => {
  expect(await reactAction(U, "👍")).toEqual({ ok: true });
  expect(await editMessageAction(U, "Oi")).toEqual({ ok: true });
  expect(await sendLocationAction(U)).toMatchObject({ ok: true });
  expect(await sendContactAction(U, { fullName: "Fulana", phone: "71988887777" })).toMatchObject({ ok: true });
  expect(asked).toEqual(["mensagem.reagir", "mensagem.editar", "mensagem.localizacao", "mensagem.contato"]);
  expect(calls).toEqual(["react", "edit", "location", "contact"]);
});
it("sem a permissão é recusada no servidor e nada é feito", async () => {
  allowed.v = false;
  for (const r of [await reactAction(U, "👍"), await editMessageAction(U, "Oi"), await sendLocationAction(U), await sendContactAction(U, { fullName: "F", phone: "7" })]) expect(r).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
