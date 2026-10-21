import { describe, expect, it } from "vitest";
import { cpfDigits, formatCpf, isValidCpf, maskCpf, cpfSearchDigits } from "./cpf";

it("confere os dígitos verificadores", () => {
  expect(isValidCpf("529.982.247-25")).toBe(true);
  expect(isValidCpf("52998224725")).toBe(true);
  expect(isValidCpf("529.982.247-24")).toBe(false);
  expect(isValidCpf("111.111.111-11")).toBe(false);
  expect(isValidCpf("123")).toBe(false);
  expect(isValidCpf(null)).toBe(false);
});

it("máscara ao digitar, guardado só com dígitos e mascarado na leitura", () => {
  expect(formatCpf("529")).toBe("529");
  expect(formatCpf("5299822")).toBe("529.982.2");
  expect(formatCpf("52998224725999")).toBe("529.982.247-25");
  expect(cpfDigits("529.982.247-25")).toBe("52998224725");
  expect(maskCpf("52998224725")).toBe("***.982.247-**");
  expect(maskCpf("")).toBe("");
});

describe("cpfSearchDigits (busca por CPF)", () => {
  it("aceita CPF inteiro ou trecho com 6+ dígitos, com ou sem máscara", () => {
    expect(cpfSearchDigits("529.982.247-25")).toBe("52998224725");
    expect(cpfSearchDigits("529982")).toBe("529982");
  });
  it("ignora termo curto ou com letras", () => {
    expect(cpfSearchDigits("52998")).toBeNull();
    expect(cpfSearchDigits("Ana 529982")).toBeNull();
    expect(cpfSearchDigits("")).toBeNull();
  });
});
