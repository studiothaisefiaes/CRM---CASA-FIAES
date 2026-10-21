import { describe, expect, it } from "vitest";
import { cNFDe, dvChave, montarChaveAcesso } from "./chave-acesso";

/**
 * Chaves de NFC-e AUTORIZADAS pela SVRS para a Bahia na homologação do Norte Vendas (AGENTS.md, 04/08 e 06/08/2026; confirmadas por
 * NfeConsultaProtocolo4): os mesmos casos do porte (scripts/nfce-referencia/gerar-nfce-teste.mjs usa a mesma fórmula).
 */
const AUTORIZADA_1 = "29260839912717000145650010000000011732405968";
const AUTORIZADA_2 = "29260839912717000145650020000000051161784640";

describe("chave de acesso (44 números, DV por módulo 11)", () => {
  it("DV das chaves conhecidas da SEFAZ-BA", () => {
    expect(dvChave(AUTORIZADA_1.slice(0, 43))).toBe(8);
    expect(dvChave(AUTORIZADA_2.slice(0, 43))).toBe(0); // resto < 2 vira 0
  });
  it("monta a chave autorizada a partir das partes", () => {
    expect(montarChaveAcesso({ cUF: 29, anoMes: "2608", cnpj: "39912717000145", serie: 1, numero: 1, cNF: "73240596" })).toBe(AUTORIZADA_1);
    expect(montarChaveAcesso({ cUF: 29, anoMes: "2608", cnpj: "39.912.717/0001-45", serie: 2, numero: 5, cNF: "16178464" })).toBe(AUTORIZADA_2);
  });
  it("recusa partes fora do formato", () => {
    expect(() => montarChaveAcesso({ cUF: 29, anoMes: "2608", cnpj: "123", serie: 1, numero: 1, cNF: "73240596" })).toThrow("CNPJ");
    expect(() => montarChaveAcesso({ cUF: 29, anoMes: "2608", cnpj: "39912717000145", serie: 1, numero: 1, cNF: "123" })).toThrow("cNF");
    expect(() => montarChaveAcesso({ cUF: 29, anoMes: "2608", cnpj: "39912717000145", serie: 1000, numero: 1, cNF: "73240596" })).toThrow("Série");
    expect(() => dvChave("123")).toThrow();
  });
  it("cNF: 8 números, nunca igual ao número da nota", () => {
    expect(cNFDe(1, () => 0)).toMatch(/^[0-9]{8}$/);
    // O sorteio que daria o próprio número (00000042) é trocado.
    expect(cNFDe(42, () => 42 / 100_000_000)).not.toBe("00000042");
    expect(cNFDe(42, () => 42 / 100_000_000)).toMatch(/^[0-9]{8}$/);
  });
});
