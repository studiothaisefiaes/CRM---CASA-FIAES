import { beforeEach, expect, it, vi } from "vitest";

const { perms, calls } = vi.hoisted(() => ({ perms: { list: [] as string[] }, calls: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: "u1", perms: perms.list }; } };
});
vi.mock("@/server/domain/fichas", () => ({
  saveQuestion: async (i: unknown) => { calls.push(i); return { id: "x" }; },
  moveQuestion: async (...i: unknown[]) => { calls.push(i); },
  setQuestionActive: async (...i: unknown[]) => { calls.push(i); },
}));
vi.mock("@/server/domain/client-photos", () => ({ savePhotoConfig: async (...i: unknown[]) => { calls.push(i); return { maxMb: 8 }; } }));
import { moveQuestionAction, saveQuestionAction, savePhotoConfigAction, setQuestionActiveAction } from "./actions";

const Q1 = "8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a11";
beforeEach(() => { calls.length = 0; });

it("sem config.fichas as três ações são recusadas no servidor e nada é gravado", async () => {
  perms.list = ["config.diaadia", "config.sistema", "fichas.responder", "fichas.ver"];
  const no = { ok: false, error: "Você não tem permissão para isso." };
  expect(await saveQuestionAction({ form: "campos", label: "Apelido", kind: "texto" })).toEqual(no);
  expect(await moveQuestionAction(Q1, "up")).toEqual(no);
  expect(await setQuestionActiveAction(Q1, false)).toEqual(no);
  expect(calls).toEqual([]);
});
it("com config.fichas grava", async () => {
  perms.list = ["config.fichas"];
  expect(await saveQuestionAction({ form: "campos", label: "Apelido", kind: "texto" })).toMatchObject({ ok: true, data: { id: "x" } });
  expect(await moveQuestionAction(Q1, "up")).toMatchObject({ ok: true });
  expect(await setQuestionActiveAction(Q1, false)).toMatchObject({ ok: true });
  expect(calls).toHaveLength(3);
});
it("argumentos inválidos são recusados antes do domínio", async () => {
  perms.list = ["config.fichas"];
  const bad = { ok: false, error: "Pedido inválido." };
  expect(await saveQuestionAction({ id: "nao-e-uuid", form: "campos", label: "X", kind: "texto" })).toEqual(bad);
  expect(await moveQuestionAction("nao-e-uuid", "up")).toEqual(bad);
  expect(await moveQuestionAction("8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a11", "sideways" as never)).toEqual(bad);
  expect(await setQuestionActiveAction("nao-e-uuid", true)).toEqual(bad);
  expect(await setQuestionActiveAction("8c2f8a0e-5b57-4a5e-9f43-2c1f0d9b7a11", "sim" as never)).toEqual(bad);
  expect(calls).toEqual([]);
});

it("tamanho máximo da foto: sem config.fichas recusa; com ela grava; número inválido é recusado antes do domínio", async () => {
  perms.list = ["fichas.ver"];
  expect(await savePhotoConfigAction({ maxMb: 8 })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(calls).toEqual([]);
  perms.list = ["config.fichas"];
  expect(await savePhotoConfigAction({ maxMb: "8" as never })).toEqual({ ok: false, error: "Pedido inválido." });
  expect(calls).toEqual([]);
  expect(await savePhotoConfigAction({ maxMb: 8 })).toMatchObject({ ok: true, data: { maxMb: 8 } });
  expect(calls).toEqual([[{ maxMb: 8 }, "u1"]]);
});
it("pergunta da Casa (id md5 da migration, não é UUID v4) é aceita", async () => {
  perms.list = ["config.fichas"];
  const md5 = "d41d8cd9-8f00-b204-e980-0998ecf8427e";
  expect(await moveQuestionAction(md5, "up")).toMatchObject({ ok: true });
  expect(await setQuestionActiveAction(md5, false)).toMatchObject({ ok: true });
  expect(await saveQuestionAction({ id: md5, form: "campos", label: "Apelido", kind: "texto" })).toMatchObject({ ok: true });
});
