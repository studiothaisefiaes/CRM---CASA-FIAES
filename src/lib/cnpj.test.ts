import { expect, it } from "vitest";
import { cnpjDigits, formatCnpj, isValidCnpj } from "./cnpj";

it("CNPJ: válido, inválido, repetido", () => {
  expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  expect(isValidCnpj("11222333000181")).toBe(true);
  expect(isValidCnpj("11222333000180")).toBe(false);
  expect(isValidCnpj("11111111111111")).toBe(false);
  expect(isValidCnpj("1122233300018")).toBe(false);
  expect(isValidCnpj(null)).toBe(false);
});
it("CNPJ: só dígitos e máscara ao digitar", () => {
  expect(cnpjDigits("11.222.333/0001-81x9")).toBe("11222333000181");
  expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  expect(formatCnpj("112223")).toBe("11.222.3");
  expect(formatCnpj("1122233300")).toBe("11.222.333/00");
});
