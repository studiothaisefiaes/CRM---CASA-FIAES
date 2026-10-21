import { describe, it, expect } from "vitest";
import config from "../../../next.config";
import { contentSecurityPolicy } from "./csp";

describe("cabeçalhos de segurança", () => {
  it("cabeçalhos globais", async () => {
    const all = await config.headers!();
    const h = Object.fromEntries(all.find((r) => r.source === "/:path*")!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["permissions-policy"]).toContain("microphone=(self)");
    expect(h["permissions-policy"]).not.toContain("notifications");
  });

  it("HSTS: o Caddy do deploy não manda (deploy/Caddyfile.example só tem encode e header -Server), então vem do Next (revisão 17/10, B2)", async () => {
    const all = await config.headers!();
    const h = Object.fromEntries(all.find((r) => r.source === "/:path*")!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["strict-transport-security"]).toBe("max-age=31536000");
  });

  it("CSP de produção: nonce + strict-dynamic, sem eval nem ws", () => {
    const csp = contentSecurityPolicy("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("media-src 'self' blob:;");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("worker-src 'self';");
    expect(csp).toContain("object-src 'none';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(csp).not.toMatch(/\s{2,}|\n/);
  });

  it("CSP de desenvolvimento libera eval (stack do React) e o websocket do HMR", () => {
    const csp = contentSecurityPolicy("abc123", true);
    expect(csp).toContain("'strict-dynamic' 'unsafe-eval';");
    expect(csp).toContain("connect-src 'self' ws:;");
  });

  it("página pública do link e do agendamento: sem cache, sem indexar e sem mandar o endereço (com o token) para o Maps", async () => {
    const all = await config.headers!();
    const idx = (s: string) => all.findIndex((r) => r.source === s);
    for (const source of ["/c/:path*", "/agendar"]) {
      expect(idx(source), source).toBeGreaterThan(idx("/:path*")); // a regra de depois vence a global (Referrer-Policy)
      const h = Object.fromEntries(all[idx(source)].headers.map((x) => [x.key.toLowerCase(), x.value]));
      expect(h, source).toMatchObject({ "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" });
    }
  });
});
