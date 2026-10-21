import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const { can } = await import("@/lib/permissions");
  return {
    assertAnyPerm: async (...ps: never[]) => { if (!ps.some((p) => can(user.perms, p))) throw new UserFacingError("Você não tem permissão para isso."); return user; },
    assertPerm: async (p: never) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; },
  };
});
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { setSetting } from "../../../../test/agenda-fixtures";
import { listProducts } from "@/server/domain/estoque/produtos";
import { movimentarEstoque, movimentosDoProduto, salvarProduto } from "./actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); user.id = s.caixaGestao.id; user.perms = [...s.caixaGestao.perms]; });
const novo = { name: "Shampoo", priceCents: 5000 };

it("salvarProduto: sem estoque.produtos, recusado no servidor e nada é gravado", async () => {
  user.perms = user.perms.filter((p) => p !== "estoque.produtos");
  expect(await salvarProduto(novo)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await listProducts()).toHaveLength(0);
});
it("salvarProduto: com a permissão grava; com Produtos e estoque desligado, recusa", async () => {
  expect((await salvarProduto(novo)).ok).toBe(true);
  expect(await listProducts()).toHaveLength(1);
  await setSetting("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" });
  const r = await salvarProduto({ name: "Condicionador", priceCents: 4000 });
  expect(r.ok ? "" : r.error).toContain("desligado");
  expect(await listProducts()).toHaveLength(1);
});
it("movimentarEstoque: sem estoque.movimentar, recusado; com a permissão grava; desligado, recusa", async () => {
  const r = await salvarProduto(novo);
  const id = r.ok ? r.data!.id : "";
  user.perms = user.perms.filter((p) => p !== "estoque.movimentar");
  expect(await movimentarEstoque({ productId: id, kind: "entrada", qty: 5 })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect((await listProducts())[0].stockQty).toBe(0);
  user.perms = [...s.caixaGestao.perms];
  expect(await movimentarEstoque({ productId: id, kind: "entrada", qty: 5 })).toEqual({ ok: true });
  expect((await listProducts())[0].stockQty).toBe(5);
  await setSetting("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" });
  const off = await movimentarEstoque({ productId: id, kind: "entrada", qty: 1 });
  expect(off.ok ? "" : off.error).toContain("desligado");
});
it("movimentosDoProduto: devolve os movimentos para quem vê a aba e recusa quem não tem nenhuma das permissões", async () => {
  const r = await salvarProduto(novo);
  const id = r.ok ? r.data!.id : "";
  await movimentarEstoque({ productId: id, kind: "entrada", qty: 3 });
  const m = await movimentosDoProduto(id);
  expect(m.ok && m.data!.map((x) => x.deltaQty)).toEqual([3]);
  user.perms = ["estoque.movimentar"];
  expect((await movimentosDoProduto(id)).ok).toBe(true);
  user.perms = [];
  expect(await movimentosDoProduto(id)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
});
