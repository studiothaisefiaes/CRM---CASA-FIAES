import { describe, expect, it } from "vitest";
import { isRevenue, methodKey, methodLabel, METHOD_ORDER } from "./methods";

describe("forma de pagamento: CRM e Avec na mesma chave", () => {
  it("nomes reais do Avec viram a chave do CRM; a bandeira sai", () => {
    expect(methodKey("Cartão Crédito (MasterCard)")).toBe("credito");
    expect(methodKey("Cartão Crédito")).toBe("credito");
    expect(methodKey("Cartão Débito (ELO)")).toBe("debito");
    expect(methodKey("Pix")).toBe("pix");
    expect(methodKey("Dinheiro")).toBe("dinheiro");
    expect(methodKey("Crédito Cliente")).toBe("credito_cliente");
  });
  it("o que não se conhece fica com o nome original; vazio vira Não informada", () => {
    expect(methodKey("Dívida")).toBe("outra:Dívida");
    expect(methodKey(" Voucher ")).toBe("outra:Voucher");
    expect(methodKey(null)).toBe("outra:Não informada");
    expect(methodKey("  ")).toBe("outra:Não informada");
  });
  it("chaves do CRM voltam iguais (inclusive a cortesia do plano 3)", () => {
    for (const k of ["pix", "credito", "debito", "dinheiro", "credito_cliente", "cortesia"]) expect(methodKey(k)).toBe(k);
  });
  it("rótulos e o que é entrada", () => {
    expect(methodLabel("credito_cliente")).toBe("Crédito da cliente");
    expect(methodLabel("cortesia")).toBe("Cortesia");
    expect(methodLabel("pix")).toBe("Pix");
    expect(methodLabel("outra:Dívida")).toBe("Dívida");
    expect(isRevenue("cortesia")).toBe(false);
    expect(isRevenue("pix")).toBe(true);
    expect(isRevenue("outra:Dívida")).toBe(true);
    expect(METHOD_ORDER).toEqual(["pix", "credito", "debito", "dinheiro", "credito_cliente", "cortesia"]);
  });
});
