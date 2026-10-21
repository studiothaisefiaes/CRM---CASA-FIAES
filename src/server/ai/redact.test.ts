import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact: nada de CPF, telefone ou e-mail vai para a IA", () => {
  it("troca CPF com e sem pontuação", () => {
    expect(redact("meu cpf é 123.456.789-09 ok")).toBe("meu cpf é [CPF] ok");
    expect(redact("cpf 12345678909")).toBe("cpf [CPF]");
  });
  // Revisão de segurança 17/10 (M4): formatos que a cliente digita e que passavam inteiros ou pela metade. 123.456.789-09 tem DV certo.
  it.each([
    ["123456789-09", "[CPF]"],
    ["123 456 789 09", "[CPF]"],
    ["123.456.789.09", "[CPF]"],
    ["123-456-789-09", "[CPF]"],
    ["123.456.789 09", "[CPF]"],
    ["12345678909", "[CPF]"],
    ["123456789/09", "[CPF]"],
  ])("troca CPF com qualquer separador: %s", (cpf, out) => {
    expect(redact(`segue meu cpf ${cpf} pra cadastro`)).toBe(`segue meu cpf ${out} pra cadastro`);
    expect(redact(`${cpf}`)).toBe(out);
  });
  it("troca CPF sem a palavra \"cpf\" quando o dígito verificador bate", () => {
    expect(redact("é 123 456 789 09, Lorena")).toBe("é [CPF], Lorena");
    expect(redact("529.982.247-25")).toBe("[CPF]");
  });
  it("depois da palavra \"cpf\", 11 dígitos com qualquer separador viram [CPF] mesmo com o dígito errado (digitação errada ainda é CPF)", () => {
    expect(redact("cpf: 123.456.789 01")).toBe("cpf: [CPF]");
    expect(redact("CPF 123 456 789 01")).toBe("CPF [CPF]");
  });
  it("3-3-3-2 sem a palavra \"cpf\" e com DV errado não vira [CPF] (não é CPF)", () => {
    expect(redact("pedido 123 456 789 01")).toBe("pedido 123 456 789 01");
  });
  it("não pega pedaço de número maior", () => {
    expect(redact("protocolo 9912345678909")).not.toContain("[CPF]");
  });
  it("troca telefone em vários formatos", () => {
    expect(redact("me liga no (71) 99999-1234")).toBe("me liga no [telefone]");
    expect(redact("whats +55 71 99999-1234 ou 71999991234")).toBe("whats [telefone] ou [telefone]");
    expect(redact("fixo 3333-4444")).toBe("fixo [telefone]");
  });
  it("troca e-mail", () => {
    expect(redact("manda pra maria.silva+x@gmail.com por favor")).toBe("manda pra [e-mail] por favor");
  });
  it("mantém preço, hora e data", () => {
    expect(redact("R$ 150,00 às 14:30 dia 22/10")).toBe("R$ 150,00 às 14:30 dia 22/10");
    expect(redact("quero 2 horários, 1 pra mim")).toBe("quero 2 horários, 1 pra mim");
  });
});
