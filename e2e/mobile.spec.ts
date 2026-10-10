import { test, expect } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

test("celular: navegação inferior, fila e conversa sem rolagem lateral", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-1010", name: "Bruna Lima", text: "Oi, tudo bem? Queria agendar." });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" }).last();
  await expect(nav.getByRole("link")).toHaveCount(4); // Hoje, Atendimento, Contatos, Relatórios (+ o botão Mais)
  await expect(nav.getByRole("button", { name: "Mais" })).toBeVisible();
  await nav.getByRole("link", { name: "Atendimento" }).click();
  await expect(page).toHaveURL(/\/atendimento/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("option", { name: /Bruna Lima/ }).first().click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const sheet = page.getByRole("region", { name: /Lead Bruna Lima/ });
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
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/); // /atendimento?lead=ID vira a conversa em tela cheia no celular
  const [row] = await e2eSql("select read_at from alerts where message like '%Carla Mendes%' limit 1");
  expect(row.read_at).not.toBeNull(); // tocar no alerta marca como lido
  await expect(page.getByRole("region", { name: /Lead Carla Mendes/ })).toBeVisible();
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

test("celular: relatórios cabem em 390 px, alvos de 44 px e mapa de calor rola só dentro do bloco", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-9090", name: "Teresa Lima", text: "Oi, queria um horário." }); // garante ao menos uma mensagem no mapa de calor
  await page.goto("/relatorios?periodo=mes");
  await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const name of ["Visão geral", "Análise"]) expect((await page.getByRole("tab", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: "Exportar" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.addStyleTag({ content: 'nav[aria-label="Principal"], nextjs-portal { display: none !important }' }); // só para o print de página inteira: barra fixa e selo do dev não repetem no meio
  await shot(page, "03-visao-geral-celular", { fullPage: true });
  for (const c of await page.locator("dl > div > dd > p.font-serif").evaluateAll((els) => els.map((el) => ({ sw: el.scrollWidth, cw: el.clientWidth })))) expect(c.sw).toBeLessThanOrEqual(c.cw);
  await page.getByRole("tab", { name: "Análise" }).click();
  await expect(page).toHaveURL(/aba=analise/);
  const region = page.getByRole("region", { name: /Mapa de calor/ });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const { sw, cw } = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(sw).toBeGreaterThan(cw); // rola dentro do bloco
  expect(cw).toBeLessThanOrEqual(390);
});

test.describe("celular: topo dos relatórios em 2x", () => {
  test.use({ deviceScaleFactor: 2 });
  test("resumo e números legíveis, sem estourar a célula", async ({ page }) => {
    await login(page);
    await page.goto("/relatorios?periodo=mes");
    await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
    await page.addStyleTag({ content: 'nav[aria-label="Principal"], nextjs-portal { display: none !important }' }); // só para o print de página inteira: barra fixa e selo do dev não repetem no meio
    await shot(page, "04-topo-celular-390x1200", { fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1200 } });
  });
});
