import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ perms: [] as string[], on: true }));
vi.mock("@/server/auth/session", () => ({
  requirePerm: async (p: string) => { if (!st.perms.includes(p)) throw new Error(`recusado:${p}`); return { id: "u1", perms: st.perms }; },
}));
vi.mock("@/server/domain/caixa/recursos", () => ({ getCaixaRecursos: async () => ({ excecoes: st.on }) }));
vi.mock("@/server/reports/financeiro/excecoes", async (orig) => ({ ...(await orig<typeof import("@/server/reports/financeiro/excecoes")>()), financeExceptions: vi.fn(async () => []) }));
vi.mock("@/components/shell/live", () => ({ LiveRefresh: () => null }));
import Page from "./page";

const run = (sp: Record<string, string> = {}) => Page({ searchParams: Promise.resolve(sp) } as Parameters<typeof Page>[0]);
const TODAS = ["relatorios.ver", "valores.ver", "relatorios.excecoes"];
beforeEach(() => { st.perms = [...TODAS]; st.on = true; });

describe("página /relatorios/excecoes", () => {
  it("com as três permissões e a página ligada, abre", async () => { expect(await run({ tipo: "sangria" })).toBeTruthy(); });
  it.each(TODAS)("sem %s, a página recusa no servidor", async (falta) => {
    st.perms = TODAS.filter((p) => p !== falta);
    await expect(run()).rejects.toThrow(`recusado:${falta}`);
  });
  it("desligada em Configurações › Caixa, dá não encontrada", async () => {
    st.on = false;
    await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
