import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy from "./proxy";

const CRM = "https://crm.217-76-54-18.sslip.io";
const req = (url: string, cookie?: string) => {
  const u = new URL(url);
  return new NextRequest(url, { headers: { host: u.host, ...(cookie ? { cookie } : {}) } });
};
const saved = { ...process.env };

describe("proxy no host dos links da cliente", () => {
  beforeEach(() => { process.env.APP_URL = CRM; process.env.CLIENT_LINK_URL = "https://agenda.casafiaes.com.br"; });
  afterEach(() => { process.env.APP_URL = saved.APP_URL; if (saved.CLIENT_LINK_URL === undefined) delete process.env.CLIENT_LINK_URL; else process.env.CLIENT_LINK_URL = saved.CLIENT_LINK_URL; });

  it("/c/<código> abre sem login (sem ir para /login nem para o host do CRM)", () => {
    const r = proxy(req("https://agenda.casafiaes.com.br/c/K7mPq2Xa"));
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(r.headers.get("content-security-policy")).toContain("nonce-");
  });

  it("qualquer outra rota nesse host vai para casafiaes.com.br, mesmo com sessão", () => {
    for (const p of ["/", "/login", "/agenda", "/contatos", "/c", "/agendarx", "/convite/abc", "/api/health", "/dev/simulador"]) {
      const r = proxy(req(`https://agenda.casafiaes.com.br${p}`, "cf_session=qualquer"));
      expect(r.status, p).toBe(307);
      expect(r.headers.get("location"), p).toBe("https://casafiaes.com.br/");
    }
  });

  it("o agendamento online (/agendar) abre nesse host, sem login (QA r58, I-5: o link que a Casa divulga)", () => {
    expect(proxy(req("https://agenda.casafiaes.com.br/agendar")).headers.get("location")).toBeNull();
  });

  it("no host do CRM nada muda: /c abre sem login, o resto pede login", () => {
    expect(proxy(req(`${CRM}/c/K7mPq2Xa`)).headers.get("location")).toBeNull();
    expect(proxy(req(`${CRM}/agenda`)).headers.get("location")).toBe(`${CRM}/login?voltar=%2Fagenda`);
    expect(proxy(req(`${CRM}/agenda`, "cf_session=x")).headers.get("location")).toBeNull();
  });

  it("sem CLIENT_LINK_URL o proxy é o de antes", () => {
    delete process.env.CLIENT_LINK_URL;
    expect(proxy(req("https://agenda.casafiaes.com.br/agenda")).headers.get("location")).toBe("https://agenda.casafiaes.com.br/login?voltar=%2Fagenda");
  });
});

describe("corpo grande de Server Action (vídeo de até 64 MB, 24/10): só nas telas que sobem vídeo", () => {
  const MB = 1024 * 1024;
  const post = (url: string, bytes: number | null, cookie?: string) => new NextRequest(url, { method: "POST", headers: {
    host: new URL(url).host, "next-action": "abc123", ...(bytes == null ? {} : { "content-length": String(bytes) }), ...(cookie ? { cookie } : {}) } });

  it("mais de 20 MB numa ação de outra tela (inclusive as sem login: /login, /c, /agendar) é recusado com 413", () => {
    for (const p of ["/login", "/c/K7mPq2Xa", "/agendar", "/convite/abc", "/conversa/123", "/config/sistema"]) {
      const r = proxy(post(`${CRM}${p}`, 30 * MB, "cf_session=x"));
      expect(r.status, p).toBe(413);
    }
  });

  it("Respostas prontas e Biblioteca aceitam até o limite do next.config; até 20 MB nada muda em lugar nenhum", () => {
    for (const p of ["/config/listas", "/config/biblioteca"]) expect(proxy(post(`${CRM}${p}`, 65 * MB, "cf_session=x")).headers.get("x-middleware-next"), p).toBe("1");
    expect(proxy(post(`${CRM}/conversa/123`, 18 * MB, "cf_session=x")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(post(`${CRM}/login`, 1000)).headers.get("x-middleware-next")).toBe("1");
  });

  it("POST comum (sem next-action) e pedido sem tamanho declarado seguem como antes", () => {
    const plain = new NextRequest(`${CRM}/login`, { method: "POST", headers: { host: new URL(CRM).host, "content-length": String(30 * MB) } });
    expect(proxy(plain).status).not.toBe(413);
    expect(proxy(post(`${CRM}/conversa/123`, null, "cf_session=x")).status).not.toBe(413);
  });
});
