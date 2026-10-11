import { it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ ip: "203.0.113.7", accepts: 0 }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": h.ip }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/server/auth/session", () => ({ createSession: async () => {} }));
vi.mock("@/server/auth/client-ip", () => ({ clientIp: (hd: Headers) => hd.get("x-forwarded-for") ?? "?" }));
vi.mock("@/server/auth/users", () => ({ acceptInvite: async () => { h.accepts++; throw new Error("Este convite expirou ou já foi usado. Peça um novo à gestão."); } }));
import { acceptInviteAction } from "./actions";

const form = () => { const f = new FormData(); f.set("password", "senha-boa-123"); f.set("confirm", "senha-boa-123"); return f; };
beforeEach(() => { h.accepts = 0; });

it("limite por IP: 10 tentativas de aceitar convite; a 11ª é recusada sem tocar no banco nem no argon2", async () => {
  h.ip = "203.0.113.7";
  for (let i = 0; i < 10; i++) expect((await acceptInviteAction("chute-" + i, {}, form())).error).toMatch(/expirou/);
  expect(h.accepts).toBe(10);
  expect((await acceptInviteAction("chute-11", {}, form())).error).toBe("Muitas tentativas. Espere alguns minutos e tente de novo.");
  expect(h.accepts).toBe(10);
});

it("o limite é por IP: outro IP continua podendo aceitar", async () => {
  h.ip = "198.51.100.9";
  expect((await acceptInviteAction("t", {}, form())).error).toMatch(/expirou/);
  expect(h.accepts).toBe(1);
});
