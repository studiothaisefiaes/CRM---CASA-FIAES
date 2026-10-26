import { beforeEach, expect, it, vi } from "vitest";

const { perms } = vi.hoisted(() => ({ perms: { list: [] as string[], id: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  return { assertPerm: async (p: Parameters<typeof can>[1]) => { if (!can(perms.list, p)) throw new UserFacingError("Você não tem permissão para isso."); return { id: perms.id, perms: perms.list }; } };
});
import { db } from "@/server/db";
import { apiKeys } from "@/server/db/schema";
import { autenticarChave } from "@/server/api/chaves";
import { resetDb } from "../../../../../test/db";
import { pessoa } from "../../../../../test/api-fixtures";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

beforeEach(async () => { await resetDb(); });

it("sem api.gerir nada é criado nem revogado", async () => {
  const u = await pessoa("atendente");
  perms.list = ["config.sistema", "equipe.gerir"]; perms.id = u.id;
  expect(await createApiKeyAction({ nome: "x", userId: u.id, escopos: ["ler"] })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await db.select().from(apiKeys)).toHaveLength(0);
  expect(await revokeApiKeyAction("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "Você não tem permissão para isso." });
});

it("com api.gerir: cria (a chave volta uma vez e funciona), com validade até o fim do dia, e revoga", async () => {
  const gestora = await pessoa("gestao");
  const ana = await pessoa("atendente");
  perms.list = ["api.gerir"]; perms.id = gestora.id;
  const r = await createApiKeyAction({ nome: "Planilha", userId: ana.id, escopos: ["ler", "escrever"], validade: "2099-12-31" });
  if (!r.ok) throw new Error(r.error);
  const chave = r.data!.chave;
  const [row] = await db.select().from(apiKeys);
  expect(row).toMatchObject({ name: "Planilha", userId: ana.id, scopes: ["ler", "escrever"], createdBy: gestora.id });
  expect(row.expiresAt?.toISOString()).toBe("2100-01-01T03:00:00.000Z");
  expect(await autenticarChave(`Bearer ${chave}`)).toMatchObject({ user: { id: ana.id } });
  expect(await createApiKeyAction({ nome: "", userId: ana.id, escopos: ["ler"] })).toEqual({ ok: false, error: "Dê um nome para a chave." });
  expect(await createApiKeyAction({ nome: "x", userId: ana.id, escopos: [] })).toMatchObject({ ok: false });
  expect(await revokeApiKeyAction(row.id)).toEqual({ ok: true });
  expect(await autenticarChave(`Bearer ${chave}`)).toMatchObject({ erro: expect.stringMatching(/revogada/) });
});

it("sem dizer a pessoa, a chave é de quem cria; quem não é da Gestão não cria em nome de outra pessoa", async () => {
  const ana = await pessoa("atendente", "Ana");
  const bia = await pessoa("atendente", "Bia");
  perms.list = ["api.gerir"]; perms.id = ana.id;
  const r = await createApiKeyAction({ nome: "Minha planilha", escopos: ["ler"] });
  if (!r.ok) throw new Error(r.error);
  expect(await autenticarChave(`Bearer ${r.data!.chave}`)).toMatchObject({ user: { id: ana.id } });
  expect(await createApiKeyAction({ nome: "da Bia", userId: bia.id, escopos: ["ler"] })).toEqual({ ok: false, error: expect.stringMatching(/Só quem é da Gestão/) });
  expect(await db.select().from(apiKeys)).toHaveLength(1);
});
