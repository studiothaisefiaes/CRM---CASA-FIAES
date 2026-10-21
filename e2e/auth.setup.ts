import { test as setup } from "@playwright/test";
import { loginReal, AUTH_FILE } from "./helpers";

// Um login real por papel; o resto da suíte reaproveita a sessão (o limite de tentativas é por IP).
// Roda depois do globalSetup (que recria o banco e as sessões).
setup("sessão da gestão", async ({ page }) => {
  await loginReal(page, "gestao@e2e.local");
  await page.context().storageState({ path: AUTH_FILE["gestao@e2e.local"] });
});

setup("sessão da atendente", async ({ page }) => {
  await loginReal(page, "ana@e2e.local");
  await page.context().storageState({ path: AUTH_FILE["ana@e2e.local"] });
});

setup("sessão da profissional", async ({ page }) => {
  await loginReal(page, "maiara@e2e.local");
  await page.context().storageState({ path: AUTH_FILE["maiara@e2e.local"] });
});
