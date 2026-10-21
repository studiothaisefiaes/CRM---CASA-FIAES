import { expect, it } from "vitest";
import { moneyInputValue, parseMoneyInput } from "./money-input";

it("o que a recepção digita vira centavos; texto estranho é null", () => {
  expect(parseMoneyInput("120")).toBe(12000);
  expect(parseMoneyInput("120,5")).toBe(12050);
  expect(parseMoneyInput("R$ 1.234,56")).toBe(123456);
  expect(parseMoneyInput("0")).toBe(0);
  expect(parseMoneyInput("")).toBeNull();
  expect(parseMoneyInput("doze")).toBeNull();
  expect(parseMoneyInput("-5")).toBeNull();
  expect(moneyInputValue(12050)).toBe("120,50");
  expect(moneyInputValue(null)).toBe("");
});
