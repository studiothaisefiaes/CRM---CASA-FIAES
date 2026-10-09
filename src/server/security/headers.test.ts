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
});
