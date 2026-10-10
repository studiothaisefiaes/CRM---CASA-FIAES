import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const E2E_DB = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", locale: "pt-BR", timezoneId: "America/Bahia" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "celular", dependencies: ["setup"], use: { ...devices["iPhone 13"], browserName: "chromium" }, testMatch: /(mobile|fila|a11y)\.spec\.ts/ },
  ],
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DB, DEV_TOOLS: "true", APP_URL: "http://localhost:3100", NEXT_DIST_DIR: ".next-e2e" },
  },
});
