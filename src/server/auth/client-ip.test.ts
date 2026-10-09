import { it, expect } from "vitest";
import { clientIp } from "./client-ip";

const H = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

it("atrás de 1 proxy confiável pega o IP adicionado pelo proxy (último)", () => {
  expect(clientIp(H("6.6.6.6, 1.2.3.4"), undefined, 1)).toBe("1.2.3.4");
});
it("sem proxy confiável ignora XFF forjado", () => {
  expect(clientIp(H("6.6.6.6"), "10.0.0.9", 0)).toBe("10.0.0.9");
});
it("sem proxy confiável e sem IP da conexão cai em local", () => {
  expect(clientIp(H("6.6.6.6"), undefined, 0)).toBe("local");
});
it("com 2 proxies pega o segundo da direita", () => {
  expect(clientIp(H("6.6.6.6, 1.2.3.4, 10.0.0.1"), undefined, 2)).toBe("1.2.3.4");
});
it("cadeia menor que os saltos usa o primeiro; sem cabeçalho usa o IP da conexão", () => {
  expect(clientIp(H("1.2.3.4"), undefined, 3)).toBe("1.2.3.4");
  expect(clientIp(H(), "10.0.0.9", 1)).toBe("10.0.0.9");
  expect(clientIp(H(), undefined, 1)).toBe("local");
});
