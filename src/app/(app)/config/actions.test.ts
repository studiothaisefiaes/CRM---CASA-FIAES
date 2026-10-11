import { it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({ assertUser: async () => ({ id: "u1", role: "gestor" }) }));
vi.mock("@/server/domain/config", async (orig) => ({
  ...(await orig<typeof import("@/server/domain/config")>()),
  addListItem: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "lists_kind_label_uq"'), { code: "23505" }); },
  updateListItem: async () => { throw new Error("Escreva o texto da resposta pronta."); },
}));
import { addListItemAction, updateListItemAction } from "./actions";

const quiet = async <T>(fn: () => Promise<T>) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

it("erro de banco não chega cru à tela de Configurações", async () => {
  const r = await quiet(() => addListItemAction("service", "Corte", null));
  expect(r).toEqual({ ok: false, error: "Não deu certo. Tente de novo." });
});
it("erro do domínio (texto fixo) continua chegando", async () => {
  expect(await updateListItemAction("00000000-0000-4000-8000-000000000000", "x", "", true)).toEqual({ ok: false, error: "Escreva o texto da resposta pronta." });
});
