import { describe, expect, it } from "vitest";
import { allocateByNet, itemCommission } from "./commission-math";
import { NEUTRAL_COMMISSION_RULES } from "./commission-rules";

const CASA = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" } as const;

describe("itemCommission", () => {
  it("R$ 200 a 40%, crédito Visa 2,43%, antecipação 7%, custo R$ 10, uma assistente a 10%", () => {
    const r = itemCommission({ baseCents: 20000, bp: 4000, cardFeeCents: 486, anticipationCents: 1400, costCents: 1000, assistants: [{ professionalId: "s", bp: 1000 }] }, CASA);
    expect(r.grossCents).toBe(8000);
    expect(r.deductions).toEqual({ cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 });
    expect(r.assistants).toEqual([{ professionalId: "s", baseCents: 18114, bp: 1000, commissionCents: 1811 }]);
    expect(r.commissionCents).toBe(4435);
  });
  it("duas assistentes: metade divide a base (centavo ímpar na segunda); sobre o total não divide", () => {
    const two = [{ professionalId: "r", bp: 1000 }, { professionalId: "b", bp: 1000 }];
    const meio = itemCommission({ baseCents: 10001, bp: 4000, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: two }, CASA);
    expect(meio.assistants.map((a) => a.baseCents)).toEqual([5000, 5001]);
    expect(itemCommission({ baseCents: 10001, bp: 4000, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: two }, { ...CASA, doisAssistentes: "total" }).assistants.map((a) => a.baseCents)).toEqual([10001, 10001]);
  });
  it("neutro = como hoje; sem regra da principal fica null mas a assistente calcula; nunca negativa", () => {
    expect(itemCommission({ baseCents: 10800, bp: 4000, cardFeeCents: 300, anticipationCents: 700, costCents: 500, assistants: [] }, NEUTRAL_COMMISSION_RULES).commissionCents).toBe(4320);
    const semRegra = itemCommission({ baseCents: 10000, bp: null, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: [{ professionalId: "s", bp: 1000 }] }, CASA);
    expect([semRegra.commissionCents, semRegra.assistants[0].commissionCents]).toEqual([null, 1000]);
    expect(itemCommission({ baseCents: 1000, bp: 1000, cardFeeCents: 0, anticipationCents: 0, costCents: 5000, assistants: [] }, CASA).commissionCents).toBe(0);
  });
});

describe("allocateByNet", () => {
  it("rateia proporcional ao líquido, trata negativo como 0 e montante 0 devolve zeros", () => {
    const m = allocateByNet([{ id: "a", total: 3000 }, { id: "b", total: 7000 }, { id: "c", total: -50 }], 1001);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([300, 701, 0]);
    expect([...allocateByNet([{ id: "a", total: 100 }], 0).values()]).toEqual([0]);
  });
});
