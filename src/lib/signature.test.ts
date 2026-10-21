// src/lib/signature.test.ts
import { describe, expect, it } from "vitest";
import { defaultSignature, isValidSignature, normalizeSignature, parseSignature, signBody, signatureDisplayName, signatureKey, signatureLine, stripSignature } from "./signature";

describe("parseSignature", () => {
  it("lê a assinatura do ChatGuru no começo da mensagem", () => {
    expect(parseSignature("*SARA - CASA FIAES:*\nOlá! Tudo bem?")).toBe("SARA");
    expect(parseSignature("*CATI - CASA FIAES:*\r\nConfirmado")).toBe("CATI");
    expect(parseSignature("*SARA - CASA FIAES:*")).toBe("SARA");
  });
  it("aceita minúsculas, acento, nome composto, espaço antes e travessão", () => {
    expect(parseSignature("*Sara - Casa Fiaes:*\nOi")).toBe("SARA");
    expect(parseSignature("*MARIA JOSÉ - CASA FIAES:*\nOi")).toBe("MARIA JOSÉ");
    expect(parseSignature("  *CATI – CASA FIAES:*\nOi")).toBe("CATI");
  });
  it("assinatura no meio do texto, citada, com número ou de outro lugar não conta", () => {
    expect(parseSignature("Oi! A Sara mandou: *SARA - CASA FIAES:*")).toBeNull();
    expect(parseSignature("> *SARA - CASA FIAES:*\nOi")).toBeNull();
    expect(parseSignature("*SARA2 - CASA FIAES:*\nOi")).toBeNull();
    expect(parseSignature("*SARA - OUTRO SALÃO:*\nOi")).toBeNull();
    expect(parseSignature("Olá! Boa tarde, tudo bem?")).toBeNull();
    expect(parseSignature(null)).toBeNull();
    expect(parseSignature("")).toBeNull();
  });
  it("assinatura na mesma linha do texto (legenda de foto, ChatGuru sem quebra) conta e sai do balão", () => {
    expect(parseSignature("*CATI - CASA FIAES:* Segue a foto do resultado")).toBe("CATI");
    expect(stripSignature("*CATI - CASA FIAES:* Segue a foto do resultado")).toBe("Segue a foto do resultado");
  });
});

describe("stripSignature", () => {
  it("tira só a assinatura do começo", () => {
    expect(stripSignature("*SARA - CASA FIAES:*\nOlá!")).toBe("Olá!");
    expect(stripSignature("Olá!")).toBe("Olá!");
    expect(stripSignature("Oi *SARA - CASA FIAES:*")).toBe("Oi *SARA - CASA FIAES:*");
    expect(stripSignature(null)).toBe("");
  });
});

describe("defaultSignature", () => {
  it("1º nome em maiúsculas; sem nome que sirva, nenhuma", () => {
    expect(defaultSignature("Sara Lima")).toBe("SARA");
    expect(defaultSignature("  joão pedro ")).toBe("JOÃO");
    expect(defaultSignature("Ana-Paula Souza")).toBe("ANAPAULA");
    expect(defaultSignature("")).toBeNull();
    expect(defaultSignature("J")).toBeNull();
    expect(defaultSignature(null)).toBeNull();
  });
});

describe("signBody", () => {
  it("põe a assinatura na primeira linha", () => {
    expect(signBody("sara", "Olá!")).toBe("*SARA - CASA FIAES:*\nOlá!");
  });
  it("sem assinatura cadastrada ou com texto já assinado, vai como está", () => {
    expect(signBody(null, "Olá!")).toBe("Olá!");
    expect(signBody("  ", "Olá!")).toBe("Olá!");
    expect(signBody("SARA", "*CATI - CASA FIAES:*\nOi")).toBe("*CATI - CASA FIAES:*\nOi");
  });
});

describe("cadastro da assinatura", () => {
  it("normaliza, compara sem acento e valida", () => {
    expect(normalizeSignature("  sara   lima ")).toBe("SARA LIMA");
    expect(signatureKey("José")).toBe(signatureKey("JOSE"));
    expect(isValidSignature("Sara")).toBe(true);
    expect(isValidSignature("Maria José")).toBe(true);
    expect(isValidSignature("S")).toBe(false);
    expect(isValidSignature("SARA 2")).toBe(false);
    expect(isValidSignature("SARA-CASA")).toBe(false);
    expect(isValidSignature("A".repeat(31))).toBe(false);
    expect(signatureLine("cati")).toBe("*CATI - CASA FIAES:*");
    expect(signatureDisplayName("MARIA JOSÉ")).toBe("Maria José");
    expect(signatureDisplayName(null)).toBeNull();
  });
});
