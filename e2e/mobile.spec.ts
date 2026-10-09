import { test, expect } from "@playwright/test";
import { login, simulate } from "./helpers";

test("celular: navegação inferior, funil e card sem rolagem lateral", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-1010", name: "Bruna Lima", text: "Oi, tudo bem? Queria agendar." });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" }).last();
  await nav.getByRole("link", { name: "Funil" }).click();
  await expect(page).toHaveURL(/\/funil/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: /Bruna Lima/ }).first().click();
  const sheet = page.getByRole("dialog", { name: /Lead Bruna Lima/ });
  await sheet.getByRole("tab", { name: "Dados" }).click();
  await expect(sheet.getByLabel("Observações")).toBeVisible();
});
