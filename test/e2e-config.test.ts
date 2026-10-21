import { afterEach, describe, expect, it } from "vitest";

const ENV = { DATABASE_URL: process.env.DATABASE_URL, EVOLUTION_URL: process.env.EVOLUTION_URL };
// O banco e a Evolution do processo voltam como estavam (os outros arquivos de teste usam o banco de teste).
afterEach(() => { process.env.DATABASE_URL = ENV.DATABASE_URL; process.env.EVOLUTION_URL = ENV.EVOLUTION_URL; });

// QA r58, T-1: o Playwright espera /api/health ANTES do globalSetup; num banco sem migrations o health dá 503 e o e2e travava 120 s.
describe("servidor do e2e", () => {
  it("roda as migrations no banco do e2e antes de subir o next dev (o health só responde com o schema pronto)", async () => {
    process.env.EVOLUTION_URL = "http://127.0.0.1:8080"; // o "real" do .env, para a guarda do config aceitar o endereço morto do e2e
    process.env.DATABASE_URL = "postgresql://crm:x@localhost:5433/crm_e2e_teste";
    const { default: config } = await import("../playwright.config");
    const ws = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    const cmd = ws?.command ?? "";
    const migrate = cmd.indexOf("drizzle-kit migrate"), dev = cmd.indexOf("next dev");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeLessThan(dev);
    expect(ws?.env?.DATABASE_URL).toBe("postgresql://crm:x@localhost:5433/crm_e2e_teste");
  });

  it("recusa banco que não é de e2e (o servidor do e2e roda migrations e o reset apaga tudo)", async () => {
    process.env.EVOLUTION_URL = "http://127.0.0.1:8080";
    process.env.DATABASE_URL = "postgresql://crm:x@localhost:5433/crm_avecfix";
    const { vi } = await import("vitest");
    vi.resetModules();
    await expect(import("../playwright.config")).rejects.toThrow("Recusado: o banco do e2e");
  });
});
