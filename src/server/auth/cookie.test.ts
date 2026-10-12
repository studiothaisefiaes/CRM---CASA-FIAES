import { it, expect } from "vitest";
import { secureSessionCookie } from "./cookie";

it("produção usa cookie seguro (só HTTPS)", () => {
  expect(secureSessionCookie({ nodeEnv: "production", demo: false })).toBe(true);
});
it("a demonstração roda em http na rede local (celular): cookie sem Secure", () => {
  expect(secureSessionCookie({ nodeEnv: "production", demo: true })).toBe(false);
});
it("desenvolvimento continua sem Secure", () => {
  expect(secureSessionCookie({ nodeEnv: "development", demo: false })).toBe(false);
});
