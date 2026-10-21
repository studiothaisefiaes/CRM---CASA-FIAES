import { describe, expect, it } from "vitest";
import { buildEarnings, type CommissionLineLike } from "./pro-earnings";

/** Linhas no formato do relatório de comissão do 6C (`CommissionLine`, src/server/domain/caixa/commission.ts). */
const line = (o: Partial<CommissionLineLike>): CommissionLineLike => ({
  itemId: "i1", day: "2026-10-16", clientName: "Paula Souza", label: "Corte", kind: "servico", baseCents: 18000, bp: 4000, commissionCents: 7200, status: "ok", ...o,
});

describe("ganhos da profissional a partir das linhas de comissão do 6C (seção 8.4.7)", () => {
  it("hoje e o mês, total só do que tem regra, mais novas primeiro, primeiro nome da cliente", () => {
    const g = buildEarnings({
      today: "2026-10-16", configured: true, showServiceValue: false, waiting: [],
      lines: [line({ itemId: "a", day: "2026-10-02", clientName: "Rita Lima", baseCents: 10000, commissionCents: 4000 }), line({ itemId: "b" })],
    });
    expect(g.today).toEqual({ totalCents: 7200, lines: [{ id: "b", day: "2026-10-16", client: "Paula", label: "Corte", pct: "40%", commissionCents: 7200, serviceCents: null, why: null }] });
    expect(g.month.totalCents).toBe(11200);
    expect(g.month.lines.map((l) => [l.day, l.client])).toEqual([["2026-10-16", "Paula"], ["2026-10-02", "Rita"]]);
  });

  it("valor do serviço só com 'Mostrar o valor'; sem regra e sessão sem valor explicam e não somam", () => {
    const g = buildEarnings({
      today: "2026-10-16", configured: true, showServiceValue: true, waiting: [],
      lines: [
        line({ itemId: "a" }),
        line({ itemId: "b", label: "Escova", baseCents: 5000, bp: null, commissionCents: null, status: "sem_regra" }),
        line({ itemId: "c", label: "Combo Método", kind: "pacote_sessao", baseCents: null, bp: 4000, commissionCents: null, status: "sem_valor_sessao" }),
      ],
    });
    expect(g.today.lines.map((l) => [l.label, l.serviceCents, l.commissionCents, l.why])).toEqual([
      ["Corte", 18000, 7200, null],
      ["Escova", 5000, null, "Comissão ainda não configurada para Escova. Fale com a gestão."],
      ["Combo Método", null, null, "Valor da sessão não definido. Fale com a gestão."],
    ]);
    expect(g.today.totalCents).toBe(7200);
  });

  it("percentual com casas: 1250 pontos-base = 12,5%", () => {
    const g = buildEarnings({ today: "2026-10-16", configured: true, showServiceValue: false, waiting: [], lines: [line({ bp: 1250, commissionCents: 2250 })] });
    expect(g.today.lines[0].pct).toBe("12,5%");
  });
});

describe("dívida da cliente (Fase A, item 6)", () => {
  it("linha retida até a cliente quitar a dívida: explica e não soma", () => {
    const g = buildEarnings({ today: "2026-10-16", configured: true, showServiceValue: false, waiting: [],
      lines: [line({ itemId: "a" }), line({ itemId: "b", status: "aguardando_quitacao" })] });
    expect(g.today.lines.map((l) => [l.id, l.commissionCents, l.pct, l.why])).toEqual([["a", 7200, "40%", null], ["b", null, null, "Espera a cliente quitar a dívida da comanda."]]);
    expect(g.today.totalCents).toBe(7200);
  });
});
