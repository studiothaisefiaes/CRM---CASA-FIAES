import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ perms: [] as string[] }));
vi.mock("@/server/auth/session", () => ({
  requirePerm: async (p: string) => { if (!st.perms.includes(p)) throw new Error(`recusado:${p}`); return { id: "u1", perms: st.perms }; },
}));
vi.mock("@/server/queries/caixa", () => ({ listTeamCash: async () => [] }));
vi.mock("@/server/domain/caixa/mode", () => ({ getCaixaMode: async () => "crm", getCaixaRules: async () => ({ exigeCaixaAberto: false, toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: null }) }));
vi.mock("@/server/domain/caixa/payment-options", () => ({ listPaymentOptions: async () => [] }));
vi.mock("@/components/shell/live", () => ({ LiveRefresh: () => null }));
import Page from "./page";

beforeEach(() => { st.perms = ["caixa.outros"]; });

describe("página /caixa/equipe", () => {
  it("com caixa.outros, abre (mesmo sem caixa.gerir)", async () => { expect(await Page()).toBeTruthy(); });
  it("só com caixa.gerir, a página recusa no servidor", async () => {
    st.perms = ["caixa.operar", "caixa.gerir"];
    await expect(Page()).rejects.toThrow("recusado:caixa.outros");
  });
});
