import { it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ ip: "203.0.113.20", accepts: 0, sessions: [] as string[], result: null as null | { id: string } | Error, landing: "/relatorios" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": h.ip }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/server/auth/session", () => ({ createSession: async (id: string) => { h.sessions.push(id); } }));
vi.mock("@/server/auth/client-ip", () => ({ clientIp: (hd: Headers) => hd.get("x-forwarded-for") ?? "?" }));
vi.mock("@/server/auth/users", () => ({ acceptInvite: async () => { throw new Error("não deveria"); }, inviteLanding: async () => h.landing }));
vi.mock("@/server/domain/contador-link", async (orig) => ({
  ...(await orig<typeof import("@/server/domain/contador-link")>()),
  acceptContadorLink: async () => { h.accepts++; if (h.result instanceof Error) throw h.result; return h.result; },
}));
import { UserFacingError } from "@/server/domain/errors";
import { acceptContadorLinkAction } from "./actions";

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "Carlos", email: "c@contabil.com", password: "senha-boa-123", confirm: "senha-boa-123", ...over })) f.set(k, v);
  return f;
};
beforeEach(() => { h.accepts = 0; h.sessions = []; h.result = new UserFacingError("Este link expirou, já foi usado ou foi cancelado. Peça um novo à gestão da Casa."); });

it("senhas diferentes: recusa sem gastar tentativa nem tocar no banco", async () => {
  h.ip = "203.0.113.21";
  expect((await acceptContadorLinkAction("t", {}, form({ confirm: "outra-senha" }))).error).toBe("As senhas não são iguais.");
  expect(h.accepts).toBe(0);
});

it("deu certo: entra (sessão nova) e vai para Relatórios", async () => {
  h.ip = "203.0.113.22";
  h.result = { id: "u-contador" };
  await expect(acceptContadorLinkAction("t", {}, form())).rejects.toThrow("NEXT_REDIRECT:/relatorios");
  expect(h.sessions).toEqual(["u-contador"]);
});

it("e-mail já cadastrado: a mensagem clara volta para a tela, sem sessão", async () => {
  h.ip = "203.0.113.23";
  h.result = new UserFacingError("Já existe um acesso com esse e-mail. Use outro e-mail ou fale com a gestão da Casa.");
  const r = await acceptContadorLinkAction("t", {}, form());
  expect(r.error).toBe("Já existe um acesso com esse e-mail. Use outro e-mail ou fale com a gestão da Casa.");
  expect(r.values).toEqual({ name: "Carlos", email: "c@contabil.com" });
  expect(h.sessions).toEqual([]);
});

it("limite por IP igual ao do convite: 10 tentativas; a 11ª é recusada sem tocar no banco nem no argon2", async () => {
  h.ip = "203.0.113.24";
  for (let i = 0; i < 10; i++) expect((await acceptContadorLinkAction("chute-" + i, {}, form())).error).toMatch(/expirou/);
  expect(h.accepts).toBe(10);
  expect((await acceptContadorLinkAction("chute-11", {}, form())).error).toBe("Muitas tentativas. Espere alguns minutos e tente de novo.");
  expect(h.accepts).toBe(10);
});
