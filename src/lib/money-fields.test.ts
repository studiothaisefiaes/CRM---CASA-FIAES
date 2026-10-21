import { it, expect } from "vitest";
import { touchesMoney } from "./money-fields";

it("reconhece quando a edição do lead mexe em dinheiro (valor, pago, forma de pagamento, cobrança)", () => {
  expect(touchesMoney({ valueCents: 100 })).toBe(true);
  expect(touchesMoney({ paymentMethod: "pix" })).toBe(true);
  expect(touchesMoney({ chargeAt: null })).toBe(true);
  expect(touchesMoney({ observations: "oi", ownerId: "x" })).toBe(false);
  expect(touchesMoney({ valueCents: undefined })).toBe(false);
});
