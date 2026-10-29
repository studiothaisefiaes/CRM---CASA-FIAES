import { describe, expect, it } from "vitest";
import { brl, decodeOrcamento, encodeOrcamento, orcamentoFileName, orcamentoSchema, totalCents } from "./orcamento";

describe("orçamento do Método em PDF", () => {
  it("o pedido vai e volta pela URL; pedido mexido ou sem item é recusado", () => {
    const o = orcamentoSchema.parse({ dealId: "6684a8c8-df12-4bcc-a62a-34425a288f00", itens: [{ nome: "Método Fiaes® (4 sessões)", valorCents: 800000 }, { nome: "Hidratação", valorCents: 15000 }] });
    expect(o.validadeDias).toBe(7);
    expect(decodeOrcamento(encodeOrcamento(o))).toEqual(o);
    expect(decodeOrcamento("xx")).toBeNull();
    expect(decodeOrcamento(Buffer.from(JSON.stringify({ ...o, itens: [] })).toString("base64url"))).toBeNull();
    expect(totalCents(o)).toBe(815000);
    expect(brl(815000).replace(/\s/g, " ")).toBe("R$ 8.150,00");
  });
  it("nome do arquivo sem caractere estranho", () => {
    expect(orcamentoFileName("Ana Souza 💛")).toBe("Orçamento Método Fiaes® - Ana Souza.pdf");
    expect(orcamentoFileName(null)).toBe("Orçamento Método Fiaes®.pdf");
  });
});
