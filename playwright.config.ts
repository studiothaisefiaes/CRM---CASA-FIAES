import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
import { assertNotRealEvolution, E2E_EVOLUTION_URL } from "./e2e/evolution-guard";

const E2E_DB = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
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
    { name: "celular", dependencies: ["setup"], use: { ...devices["iPhone 13"], browserName: "chromium" }, testMatch: /(mobile|fila|conversa|cliente|contatos|jornada|hoje|a11y)\.spec\.ts/ },
  ],
  webServer: {
    // A guarda roda antes do servidor e recusa subir se o EVOLUTION_URL que ele vai receber for o da Evolution real.
    // Cache de build novo a cada execução: um .next-e2e velho (de outro estado do código) já deixou o dev server recarregando a página em laço.
    command: `npx tsx e2e/evolution-guard.ts && rm -rf .next-e2e && npx next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DB, DEV_TOOLS: "true", APP_URL: BASE_URL, NEXT_DIST_DIR: ".next-e2e", EVOLUTION_URL: E2E_EVOLUTION_URL },
  },
});
