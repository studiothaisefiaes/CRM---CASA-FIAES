import { describe, expect, it } from "vitest";
import { bpToPercent, CARD_BRANDS, CARD_BRAND_LABEL, cashDifference, changeFor, checkNewPayment, checkPayments, comandaTotals, commissionCents, discountFrom, DRAWER_METHODS, expectedByMethod, expectedCash, feeCents, fiscalKindOf, itemTotal, PAY_LABEL, PAY_METHODS, percentToBp, splitDiscount } from "./comanda-math";
import { money } from "./format";

describe("itens e desconto", () => {
  it("total do item: quantidade × preço − desconto, nunca negativo; sem preço = null", () => {
    expect(itemTotal({ qty: 2, unitCents: 5000, discountCents: 1000 })).toBe(9000);
    expect(itemTotal({ qty: 1, unitCents: 5000, discountCents: 9000 })).toBe(0);
    expect(itemTotal({ qty: 1, unitCents: null, discountCents: 0 })).toBeNull();
    expect(itemTotal({ qty: 1.5, unitCents: 3333, discountCents: 0 })).toBe(5000); // arredonda o centavo
  });

  it("desconto em R$ ou em %; % arredonda para o centavo", () => {
    expect(discountFrom({ cents: 1500 }, 12000)).toBe(1500);
    expect(discountFrom({ percent: 10 }, 12345)).toBe(1235);
    expect(discountFrom({}, 12000)).toBe(0);
  });

  it("rateio do desconto da comanda: proporcional, a sobra do arredondamento vai para o maior item", () => {
    const m = splitDiscount([{ id: "a", total: 10000 }, { id: "b", total: 5000 }, { id: "c", total: 5000 }], 1001);
    expect([...m.values()].reduce((x, y) => x + y, 0)).toBe(1001);
    expect(m.get("a")).toBe(501);
    expect(m.get("b")).toBe(250);
    expect(m.get("c")).toBe(250);
    expect(splitDiscount([{ id: "a", total: 0 }], 0).get("a")).toBe(0);
  });

  it("totais: subtotal, desconto, total e quem está sem preço", () => {
    const t = comandaTotals([
      { id: "a", label: "Corte", qty: 1, unitCents: 12000, discountCents: 0 },
      { id: "b", label: "Mechas", qty: 1, unitCents: null, discountCents: 0 },
      { id: "c", label: "Shampoo", qty: 2, unitCents: 3000, discountCents: 500 },
    ], 1000);
    expect(t).toMatchObject({ subtotalCents: 17500, discountCents: 1000, totalCents: 16500, missingPrice: ["Mechas"] });
    expect(t.shares.get("a")! + t.shares.get("c")!).toBe(1000);
  });
});

describe("comissão, pagamento e caixa", () => {
  it("comissão: base × % com meio centavo para cima", () => {
    expect(commissionCents(10000, 4000)).toBe(4000);
    expect(commissionCents(1001, 5000)).toBe(501); // 500,5 → 501
    expect(commissionCents(1003, 3333)).toBe(334); // 334,2999 → 334
    expect(commissionCents(0, 4000)).toBe(0);
  });

  it("pagamento: precisa bater; só o dinheiro passa do total (vira troco)", () => {
    expect(checkPayments(10000, [{ method: "pix", valueCents: 4000 }, { method: "dinheiro", valueCents: 7000 }])).toEqual({ ok: true, paidCents: 11000, changeCents: 1000 });
    expect(checkPayments(10000, [{ method: "pix", valueCents: 9000 }])).toEqual({ ok: false, error: `Faltam ${money(1000)} para fechar.` }); // money() usa o espaço fino do pt-BR
    expect(checkPayments(10000, [{ method: "credito", valueCents: 11000 }])).toEqual({ ok: false, error: "Só o dinheiro pode passar do total." });
    // Regra do Norte: as outras formas cobrem o total; o dinheiro inteiro volta como troco.
    expect(checkPayments(10000, [{ method: "credito", valueCents: 8000 }, { method: "dinheiro", valueCents: 1000 }, { method: "debito", valueCents: 2000 }]))
      .toEqual({ ok: true, paidCents: 11000, changeCents: 1000 });
    expect(checkPayments(0, [])).toEqual({ ok: true, paidCents: 0, changeCents: 0 });
  });

  it("troco (Norte, calculateChangeForMethods): só sobre o que o dinheiro precisava cobrir", () => {
    expect(changeFor([{ method: "pix", valueCents: 5000 }, { method: "dinheiro", valueCents: 10000 }], 12000)).toBe(3000);
    expect(changeFor([{ method: "dinheiro", valueCents: 5000 }], 12000)).toBe(0);
    expect(changeFor([{ method: "cortesia", valueCents: 12000 }, { method: "dinheiro", valueCents: 2000 }], 12000)).toBe(2000);
    expect(changeFor([], 0)).toBe(0);
  });

  it("novo pagamento: outra forma não passa do restante; dinheiro passa; comanda paga não recebe mais", () => {
    expect(checkNewPayment({ totalCents: 12000, paidCents: 5000, method: "pix", valueCents: 8000 })).toBe(`Passa do que falta (${money(7000)}). Só o dinheiro pode passar e virar troco.`);
    expect(checkNewPayment({ totalCents: 12000, paidCents: 5000, method: "pix", valueCents: 7000 })).toBeNull();
    expect(checkNewPayment({ totalCents: 12000, paidCents: 5000, method: "dinheiro", valueCents: 10000 })).toBeNull();
    expect(checkNewPayment({ totalCents: 12000, paidCents: 12000, method: "dinheiro", valueCents: 100 })).toBe("Essa comanda já está paga.");
    expect(checkNewPayment({ totalCents: 0, paidCents: 0, method: "pix", valueCents: 100 })).toBe("Essa comanda já está paga.");
  });

  it("formas, bandeiras (catálogo do Norte) e o tipo para a nota", () => {
    expect(PAY_METHODS).toEqual(["pix", "credito", "debito", "dinheiro", "cortesia", "credito_cliente", "outra"]);
    expect(PAY_LABEL.outra).toBe("Outra forma");
    expect(DRAWER_METHODS).toEqual(["dinheiro", "pix", "credito", "debito", "outra"]);
    expect(CARD_BRANDS).toEqual(["visa", "mastercard", "elo", "amex", "hipercard", "alelo", "sodexo", "ticket", "vr", "cabal", "outro"]);
    expect(CARD_BRAND_LABEL.outro).toBe("Outra");
    expect(fiscalKindOf("produto")).toBe("produto");
    expect(fiscalKindOf("pacote_venda")).toBe("servico");
    expect(fiscalKindOf("servico")).toBe("servico");
  });

  it("dinheiro esperado = fundo + dinheiro líquido do troco + suprimentos − sangrias; a conferência por forma (o não contado vale zero)", () => {
    expect(expectedCash({ openingCents: 10000, cashInCents: 25000, changeOutCents: 1500, suprimentosCents: 2000, sangriasCents: 8000 })).toBe(27500);
    const exp = expectedByMethod({ openingCents: 10000, received: [{ method: "pix", valueCents: 5000 }, { method: "dinheiro", valueCents: 2500 }, { method: "credito_cliente", valueCents: 999 }, { method: "cortesia", valueCents: 700 }, { method: "outra", valueCents: 300 }], suprimentosCents: 0, sangriasCents: 0 });
    expect(exp).toEqual({ dinheiro: 12500, pix: 5000, credito: 0, debito: 0, outra: 300 });
    expect(cashDifference(exp, { pix: 5000, dinheiro: 12000, outra: 300 })).toEqual({ byMethod: { dinheiro: -500, pix: 0, credito: 0, debito: 0, outra: 0 }, totalCents: -500 });
    expect(cashDifference({ dinheiro: 1000, pix: 500 }, { dinheiro: 900 })).toEqual({ byMethod: { dinheiro: -100, pix: -500 }, totalCents: -600 });
  });

  it("% digitado vira pontos-base; fora de 0 a 100 é inválido", () => {
    expect(percentToBp("40")).toBe(4000);
    expect(percentToBp("12,5")).toBe(1250);
    expect(percentToBp(" 7.25 ")).toBe(725);
    expect(percentToBp("101")).toBeNull();
    expect(percentToBp("abc")).toBeNull();
    expect(percentToBp("")).toBeNull();
    expect(bpToPercent(1250)).toBe("12,5");
    expect(bpToPercent(4000)).toBe("40");
    expect(bpToPercent(null)).toBe("");
  });
});

describe("feeCents", () => {
  it("taxa do cartão arredonda como a comissão", () => { expect(feeCents(10000, 243)).toBe(243); expect(feeCents(12345, 199)).toBe(246); });
});
