import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/fichas", () => ({ saveAnswer: async (...a: unknown[]) => { calls.push(["answer", ...a]); } }));
vi.mock("@/server/domain/client-photos", () => ({
  addClientPhoto: async (...a: unknown[]) => { calls.push(["add", ...a]); return { id: "p1" }; },
  removeClientPhoto: async (...a: unknown[]) => { calls.push(["remove", ...a]); },
}));
import { addClientPhotoAction, removeClientPhotoAction, saveFichaAnswerAction } from "./actions";

const C = "8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a11", Q = "8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a12", V = "8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a13";
const NO = { ok: false, error: "Você não tem permissão para isso." };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const form = (o: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("contactId", C); fd.set("kind", "antes"); fd.set("photo", new File([JPEG], "x.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
beforeEach(() => { calls.length = 0; });

it("cada action sem a sua permissão é recusada no servidor e nada é gravado", async () => {
  perms.list = ["contatos.ver", "fichas.ver", "fotos.apagar"]; // falta fichas.responder e fotos.adicionar
  expect(await saveFichaAnswerAction({ contactId: C, questionId: Q, value: "x" })).toEqual(NO);
  expect(await addClientPhotoAction(form())).toEqual(NO);
  perms.list = ["fichas.responder", "fotos.adicionar"]; // falta fotos.apagar
  expect(await removeClientPhotoAction(V)).toEqual(NO);
  expect(calls).toEqual([]);
});
it("com a permissão grava (visita opcional na resposta e na foto)", async () => {
  perms.list = ["fichas.responder", "fotos.adicionar", "fotos.apagar"];
  expect(await saveFichaAnswerAction({ contactId: C, questionId: Q, visitId: V, value: ["a"] })).toMatchObject({ ok: true });
  expect(await addClientPhotoAction(form({ visitId: V }))).toMatchObject({ ok: true, data: { id: "p1" } });
  expect(await removeClientPhotoAction(V)).toMatchObject({ ok: true });
  expect(calls.map((c) => c[0])).toEqual(["answer", "add", "remove"]);
  expect(calls[0].slice(1)).toEqual([{ contactId: C, questionId: Q, visitId: V, value: ["a"] }, "u1"]);
  expect(calls[1][1]).toMatchObject({ contactId: C, visitId: V, kind: "antes" });
  expect(Buffer.isBuffer((calls[1][1] as { data: unknown }).data)).toBe(true);
});
it("pergunta da Casa (id md5 da migration, não é UUID v4) é aceita", async () => {
  perms.list = ["fichas.responder"];
  const md5 = "d41d8cd9-8f00-b204-e980-0998ecf8427e";
  expect(await saveFichaAnswerAction({ contactId: C, questionId: md5, value: "x" })).toMatchObject({ ok: true });
  expect(calls).toHaveLength(1);
});
it("pedido mal formado é recusado sem tocar no domínio", async () => {
  perms.list = ["fichas.responder", "fotos.adicionar", "fotos.apagar"];
  expect(await saveFichaAnswerAction({ contactId: "x", questionId: Q, value: "x" })).toMatchObject({ ok: false });
  expect(await addClientPhotoAction(form({ kind: "durante" }))).toMatchObject({ ok: false });
  const semFoto = form(); semFoto.delete("photo");
  expect(await addClientPhotoAction(semFoto)).toEqual({ ok: false, error: "Escolha uma foto." });
  expect(await removeClientPhotoAction("nope")).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});

vi.mock("@/server/domain/merge-contacts", () => ({
  previewMerge: async () => ({ keep: { id: C, name: null, phone: "+5571966001001" }, drop: { id: C, name: null, phone: "+5571966001002" }, moving: {}, blockers: [] }),
  mergeContacts: async (...a: unknown[]) => { calls.push(["merge", ...a]); return { moved: {} }; },
}));
vi.mock("@/server/queries/duplicate-suspects", () => ({ searchMergeTargets: async () => [] }));
it("unir: sem contatos.unir é recusado; sem 'Estou ciente' não grava; com tudo une", async () => {
  const { mergeContactsAction, previewMergeAction } = await import("./actions");
  perms.list = ["contatos.ver", "fichas.responder"];
  expect(await mergeContactsAction(C, Q, true)).toEqual(NO);
  expect(await previewMergeAction(C, Q)).toEqual(NO);
  perms.list = ["contatos.unir"];
  expect(await mergeContactsAction(C, Q, false)).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
  expect(await mergeContactsAction(C, Q, true)).toMatchObject({ ok: true, data: { keptId: C } });
  expect(calls[0]).toEqual(["merge", { keepId: C, dropId: Q }, "u1"]);
});
