import { beforeEach, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ perms: ["caixa.operar"] as string[], catalogExtra: null as unknown }));
vi.mock("@/server/auth/session", () => ({
  requirePerm: async (p: string) => { if (!st.perms.includes(p)) throw new Error(`recusado:${p}`); return { id: "u1", perms: st.perms }; },
}));
vi.mock("@/server/domain/caixa/mode", () => ({ getCaixaMode: async () => "crm", getCaixaRules: async () => ({ contagemCega: true }) }));
vi.mock("@/server/domain/caixa/payment-options", () => ({ listPaymentOptions: async () => [{ id: "o1", label: "Vale-presente", active: true }] }));
vi.mock("@/server/domain/professionals", () => ({ listProfessionals: async () => [] }));
vi.mock("@/server/queries/caixa", () => ({ isBlindFor: () => true }));
vi.mock("@/server/queries/comanda-catalog", () => ({ buildComandaCatalog: async (_u: unknown, extra: unknown) => { st.catalogExtra = extra; return { services: [] }; } }));
vi.mock("@/server/queries/comandas-list", () => ({ listComandas: async () => ({ rows: [], total: 0 }) }));
vi.mock("@/components/shell/live", () => ({ LiveRefresh: () => null }));
vi.mock("@/components/caixa/caixa-nav", () => ({ CaixaNav: () => null }));
import Page from "./page";

beforeEach(() => { st.perms = ["caixa.operar"]; st.catalogExtra = null; });

it("só com caixa.operar", async () => {
  st.perms = [];
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("recusado:caixa.operar");
});

it("revisão final: a comanda aberta daqui recebe com as 'Outra forma' ativas, como no Caixa", async () => {
  await Page({ searchParams: Promise.resolve({}) });
  expect(st.catalogExtra).toMatchObject({ paymentOptions: [{ id: "o1", label: "Vale-presente" }] });
});
