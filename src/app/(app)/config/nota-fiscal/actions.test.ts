import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const { can } = await import("@/lib/permissions");
  return { assertPerm: async (p: never) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; } };
});
import { resetDb } from "../../../../../test/db";
import { setupCaixa } from "../../../../../test/caixa-fixtures";
import { DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS } from "@/lib/fiscal-settings";
import { getFiscalEmpresa, getFiscalRegras, getNfceModo, getNfseModo } from "@/server/domain/fiscal/config";
import { mudarNfceModo, mudarNfseModo, salvarFiscalEmpresa, salvarFiscalRegras } from "./actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); user.id = s.caixaGestao.id; user.perms = [...s.caixaGestao.perms]; });
const empresa = { ...DEFAULT_FISCAL_EMPRESA, cnpj: "11.222.333/0001-81" };

it("sem nota.configurar, as três ações são recusadas no servidor e nada muda (config.sistema e caixa.gerir não bastam)", async () => {
  user.perms = user.perms.filter((p) => p !== "nota.configurar");
  expect(user.perms).toContain("config.sistema");
  expect(await salvarFiscalEmpresa(empresa)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await mudarNfseModo("teste")).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await salvarFiscalRegras(DEFAULT_FISCAL_REGRAS)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await getFiscalEmpresa()).toEqual(DEFAULT_FISCAL_EMPRESA);
  expect(await getNfseModo()).toBe("desligada");
  expect(await getFiscalRegras()).toEqual(DEFAULT_FISCAL_REGRAS);
});
it("com a permissão grava; erro de regra volta com a frase do domínio", async () => {
  expect(await salvarFiscalEmpresa(empresa)).toEqual({ ok: true });
  expect((await getFiscalEmpresa()).cnpj).toBe("11222333000181");
  expect(await salvarFiscalEmpresa({ ...empresa, aliquotaIssBp: 350 })).toEqual({ ok: true });
  expect((await getFiscalEmpresa()).aliquotaIssBp).toBe(350);
  expect(await mudarNfseModo("teste")).toEqual({ ok: true });
  expect(await getNfseModo()).toBe("teste");
  expect(await mudarNfseModo("producao")).toEqual({ ok: false, error: "Antes da produção, emita e confira uma nota no modo Teste." });
  expect(await salvarFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, certAvisoDias: 45 })).toEqual({ ok: true });
  expect((await getFiscalRegras()).certAvisoDias).toBe(45);
  const r = await salvarFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, tentativasMax: 0 });
  expect(r.ok ? "" : r.error).toContain("Tentativas de envio");
});

it("a chave da NFC-e: sem nota.configurar recusa no servidor; com ela, liga em teste (sem mexer na NFS-e)", async () => {
  user.perms = user.perms.filter((p) => p !== "nota.configurar");
  expect(await mudarNfceModo("teste")).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await getNfceModo()).toBe("desligada");
  user.perms = [...s.caixaGestao.perms];
  expect(await mudarNfceModo("teste")).toEqual({ ok: true });
  expect(await getNfceModo()).toBe("teste");
  expect(await getNfseModo()).toBe("desligada");
  expect(await mudarNfceModo("producao")).toEqual({ ok: false, error: "Antes da produção, emita e confira uma NFC-e no modo Teste." });
});
