import { test, expect } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

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

test("celular: sino abre o painel embaixo e tocar no alerta abre o lead", async ({ page }) => {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await login(page);
  await simulate(page, { phone: "71 99700-3030", name: "Carla Mendes", text: "Oi, tem horário amanhã?" });
  ageLead("+5571997003030", 11);
  await page.goto("/");
  const bell = page.getByRole("button", { name: /Alertas, [1-9]/ }).first();
  expect((await bell.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await bell.tap();
  const panel = page.getByRole("dialog", { name: "Alertas" });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(500); // fim da animação
  const vp = page.viewportSize()!;
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.y + box.height)).toBe(vp.height); // colado embaixo
  expect(box.height).toBeLessThanOrEqual(vp.height * 0.8 + 1);
  const item = panel.getByRole("link", { name: /Carla Mendes/ }).first();
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "01-sino-celular");
  await item.tap();
  await expect(page).toHaveURL(/\/funil\?lead=/);
  await expect(page.getByRole("dialog", { name: /Lead Carla Mendes/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Alertas" })).toHaveCount(0);
});

test("celular: banner de conexão cabe em 390 px", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status) values ('Salão', 'e2e-banner-m', 'erro')");
  try {
    await login(page);
    await expect(page.getByTestId("banner-conexao")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await e2eSql("delete from channels where instance_name = 'e2e-banner-m'"); }
});
