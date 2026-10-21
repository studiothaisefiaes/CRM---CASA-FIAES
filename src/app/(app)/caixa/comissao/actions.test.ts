import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: string) => { if (!user.perms.includes(p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check, assertAnyPerm: check, assertUser: async () => user };
});
vi.mock("@/server/domain/caixa/commission-rules", () => ({
  saveCommissionRules: vi.fn(async () => {}), saveProfessionalCommissionRules: vi.fn(async () => {}), setAssistantCommission: vi.fn(async () => {}),
}));
vi.mock("@/server/domain/caixa/adjustments", () => ({
  addAdjustment: vi.fn(async () => ({ id: "a1" })), cancelAdjustment: vi.fn(async () => {}), saveAdjustmentRule: vi.fn(async () => ({ id: "r1" })),
}));
vi.mock("@/server/domain/caixa/payouts", () => ({
  payableFor: vi.fn(async () => ({ lines: [] })), payCommission: vi.fn(async () => ({ id: "p1", number: 1, netCents: 4800 })), undoPayout: vi.fn(async () => {}),
}));
vi.mock("@/server/domain/caixa/commission", () => ({ setCommission: vi.fn(async () => {}), applyCommissionToCategory: vi.fn(async () => ({ updated: 1 })) }));
import * as dom from "@/server/domain/caixa/commission-rules";
import * as adj from "@/server/domain/caixa/adjustments";
import * as com from "@/server/domain/caixa/commission";
import * as pay from "@/server/domain/caixa/payouts";
import { payableAction, payCommissionAction, undoPayoutAction, addAdjustmentAction, cancelAdjustmentAction, saveAdjustmentRuleAction, saveCommissionRulesAction, saveProCommissionRulesAction, setAssistantCommissionAction } from "./actions";
import { applyCommissionCategoryAction, setCommissionAction } from "../actions";

beforeEach(() => { user.perms = []; vi.clearAllMocks(); });
const ID = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222";
const RULES = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" } as const;
const NO = { ok: false, error: "Você não tem permissão para isso." };

const calls: [string, () => Promise<unknown>, () => unknown][] = [
  ["regras da Casa", () => saveCommissionRulesAction(RULES), () => dom.saveCommissionRules],
  ["regra da profissional", () => saveProCommissionRulesAction(ID, { cartao: "nao" }), () => dom.saveProfessionalCommissionRules],
  ["% da assistente", () => setAssistantCommissionAction({ professionalId: ID, serviceId: ID2, bp: 1000 }), () => dom.setAssistantCommission],
  ["% da profissional", () => setCommissionAction({ professionalId: ID, serviceId: ID2, bp: 4000 }), () => com.setCommission],
  ["% da categoria", () => applyCommissionCategoryAction({ professionalId: ID, category: "Cabelo", bp: 4000 }), () => com.applyCommissionToCategory],
];

for (const [nome, call, fn] of calls) {
  it(`${nome}: sem comissao.regras é recusado no servidor (nem config.sistema basta)`, async () => {
    expect(await call()).toEqual(NO);
    user.perms = ["config.sistema", "comissao.ver", "comissao.pagar"];
    expect(await call()).toEqual(NO);
    expect(fn()).not.toHaveBeenCalled();
    user.perms = ["comissao.regras"];
    expect(await call()).toMatchObject({ ok: true });
    expect(fn()).toHaveBeenCalledTimes(1);
  });
}

it("regra própria: nada marcado ou null volta a seguir a Casa; valor inválido não chega ao domínio", async () => {
  user.perms = ["comissao.regras"];
  expect(await saveProCommissionRulesAction(ID, null)).toMatchObject({ ok: true });
  expect(dom.saveProfessionalCommissionRules).toHaveBeenCalledWith(ID, null, expect.anything());
  expect((await saveProCommissionRulesAction(ID, { cartao: "xis" as never })).ok).toBe(false);
  expect((await saveCommissionRulesAction({ ...RULES, antecipacaoBp: 99999 })).ok).toBe(false);
  expect(dom.saveCommissionRules).not.toHaveBeenCalled();
});

const ADJ = { professionalId: ID, kind: "vale" as const, valueCents: 5000, day: "2026-10-10", note: "Adiantamento" };
const RULE = { professionalId: ID, kind: "bonus" as const, valueCents: 10000, dayOfMonth: 5, startsOn: "2026-08-01", note: "Meta", active: true };
const lancar: [string, () => Promise<unknown>, () => unknown][] = [
  ["lançar", () => addAdjustmentAction(ADJ), () => adj.addAdjustment],
  ["cancelar lançamento", () => cancelAdjustmentAction(ID, { reason: "Errado" }), () => adj.cancelAdjustment],
  ["salvar o 'todo mês'", () => saveAdjustmentRuleAction(RULE), () => adj.saveAdjustmentRule],
];
for (const [nome, call, fn] of lancar) {
  it(`${nome}: pede comissao.lancar; só comissao.pagar não basta`, async () => {
    expect(await call()).toEqual(NO);
    user.perms = ["comissao.pagar", "comissao.ver", "comissao.regras"];
    expect(await call()).toEqual(NO);
    expect(fn()).not.toHaveBeenCalled();
    user.perms = ["comissao.lancar"];
    expect(await call()).toMatchObject({ ok: true });
    expect(fn()).toHaveBeenCalledTimes(1);
  });
}
it("lançamento inválido não chega ao domínio", async () => {
  user.perms = ["comissao.lancar"];
  expect((await addAdjustmentAction({ ...ADJ, kind: "x" as never })).ok).toBe(false);
  expect((await saveAdjustmentRuleAction({ ...RULE, dayOfMonth: 31 })).ok).toBe(false);
  expect(adj.addAdjustment).not.toHaveBeenCalled();
});

/** Pagar a comissão (Tarefa 9): pedem `comissao.pagar`; `comissao.lancar` (nem ver e regras) não basta. */
const pagar: [string, () => Promise<unknown>, () => unknown][] = [
  ["ver o a pagar", () => payableAction(ID, "2026-09-30"), () => pay.payableFor],
  ["pagar", () => payCommissionAction({ professionalId: ID, until: "2026-09-30", expectedNetCents: 4800 }), () => pay.payCommission],
  ["desfazer o pagamento", () => undoPayoutAction(ID, { reason: "Pago errado" }), () => pay.undoPayout],
];
for (const [nome, call, fn] of pagar) {
  it(`${nome}: pede comissao.pagar; só comissao.lancar não basta`, async () => {
    expect(await call()).toEqual(NO);
    user.perms = ["comissao.lancar", "comissao.ver", "comissao.regras"];
    expect(await call()).toEqual(NO);
    expect(fn()).not.toHaveBeenCalled();
    user.perms = ["comissao.pagar"];
    expect(await call()).toMatchObject({ ok: true });
    expect(fn()).toHaveBeenCalledTimes(1);
  });
}
it("pagamento inválido não chega ao domínio", async () => {
  user.perms = ["comissao.pagar"];
  expect((await payCommissionAction({ professionalId: ID, until: "30/09", expectedNetCents: 1 })).ok).toBe(false);
  expect((await payCommissionAction({ professionalId: "x", until: "2026-09-30", expectedNetCents: 1 })).ok).toBe(false);
  expect((await payableAction(ID, "ontem")).ok).toBe(false);
  expect(pay.payCommission).not.toHaveBeenCalled();
  expect(pay.payableFor).not.toHaveBeenCalled();
});
