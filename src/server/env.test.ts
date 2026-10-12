import { it, expect } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://crm:x@localhost:5433/crm", EVOLUTION_URL: "http://127.0.0.1:9", EVOLUTION_API_KEY: "k".repeat(20),
  WEBHOOK_SECRET: "w".repeat(30), WEBHOOK_PUBLIC_URL: "http://localhost:3000", SESSION_SECRET: "s".repeat(40), APP_URL: "http://localhost:3000",
};
const demoDb = "postgres://crm:x@localhost:5433/crm_demo";

it("sem DEMO nada muda: demo desligado e simulador desligado em produção", () => {
  const e = parseEnv({ ...base, NODE_ENV: "production", DEV_TOOLS: "true" });
  expect(e.DEMO).toBe(false);
  expect(e.DEV_TOOLS).toBe(false);
});
it("DEMO=true no banco crm_demo liga a demonstração e mantém o simulador mesmo no build de produção", () => {
  const e = parseEnv({ ...base, DATABASE_URL: demoDb, NODE_ENV: "production", DEV_TOOLS: "true", DEMO: "true" });
  expect(e.DEMO).toBe(true);
  expect(e.DEV_TOOLS).toBe(true);
});
it("DEMO=true não liga o simulador sozinho", () => {
  expect(parseEnv({ ...base, DATABASE_URL: demoDb, NODE_ENV: "production", DEMO: "true" }).DEV_TOOLS).toBe(false);
});
it("DEMO=true fora do banco crm_demo é recusado (nunca o banco real com WhatsApp falso)", () => {
  expect(() => parseEnv({ ...base, DEMO: "true" })).toThrow(/crm_demo/);
});
