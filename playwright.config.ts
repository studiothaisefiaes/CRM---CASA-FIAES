import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
import { assertNotRealEvolution, E2E_EVOLUTION_URL } from "./e2e/evolution-guard";

const E2E_DB = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
// O servidor do e2e roda as migrations e o reset apaga tudo: só num banco crm_e2e* (nunca o do .env, se ele não terminar em /crm).
if (!/\/crm_e2e[a-z0-9_]*(\?|$)/.test(E2E_DB)) throw new Error(`Recusado: o banco do e2e precisa ser crm_e2e ou crm_e2e_<nome> (veio ${E2E_DB.replace(/\/\/[^@]*@/, "//***@")}).`);
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const CLIENT_URL = `http://127.0.0.1:${PORT}`;
// Nunca a Evolution real (localhost:8080 = WhatsApp da Recepção conectado): o servidor do e2e recebe um endereço morto.
assertNotRealEvolution(E2E_EVOLUTION_URL, { realUrl: process.env.EVOLUTION_URL, realPort: process.env.EVOLUTION_PORT });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", locale: "pt-BR", timezoneId: "America/Bahia" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "celular", dependencies: ["setup"], use: { ...devices["iPhone 13"], browserName: "chromium" }, testMatch: /(mobile|design-sistema|fila|conversa|cliente|contatos|jornada|hoje|a11y|agenda-base|agenda-viva|agenda-nova|caixa|profissional|link-cliente|fase-a)\.spec\.ts/ },
  ],
  webServer: {
    // A guarda roda antes do servidor e recusa subir se o EVOLUTION_URL que ele vai receber for o da Evolution real.
    // As migrations rodam aqui (QA r58, T-1): o Playwright espera o /api/health antes do globalSetup, e num banco sem schema o health dá 503.
    // Cache de build novo a cada execução: um .next-e2e velho (de outro estado do código) já deixou o dev server recarregando a página em laço.
    command: `npx tsx e2e/evolution-guard.ts && npx drizzle-kit migrate && rm -rf .next-e2e && npx next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // IA com chave falsa e endereço morto: o e2e nunca chama a Anthropic (a sugestão é gravada direto no banco pelo spec).
    env: { ANTHROPIC_API_KEY: "sk-e2e-falsa", AI_BASE_URL: process.env.E2E_AI_BASE_URL || "http://127.0.0.1:9/v1/messages", DATABASE_URL: E2E_DB, DEV_TOOLS: "true", APP_URL: BASE_URL,
      // Domínio dos links da cliente: o mesmo servidor por outro host (127.0.0.1), para provar que nele só /c responde.
      CLIENT_LINK_URL: CLIENT_URL, NEXT_DIST_DIR: ".next-e2e", EVOLUTION_URL: E2E_EVOLUTION_URL, PDF_BASE_URL: BASE_URL },
  },
});
