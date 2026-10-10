import { test, expect } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

test.describe.configure({ mode: "serial" });

const TIPOS = ["numeros", "resposta", "funil", "parados", "canal", "origem", "objecoes", "qualidade", "followup", "calor"];
const SO_GESTAO = ["pessoas", "financeiro", "cobrancas"];

test.beforeAll(async () => {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("clicar em 'Ver atrasados' abre a lista filtrada", async ({ page }) => {
  await login(page);
  // Dois leads novos: um fica sem resposta e passa do prazo, o outro é respondido a tempo.
  await simulate(page, { phone: "71 99700-7001", name: "Larissa Prado", text: "Oi, vim pelo Instagram, quanto custa a escova?" });
  await simulate(page, { phone: "71 99700-7002", name: "Helena Duarte", text: "Boa tarde, tem horário hoje?" });
  await simulate(page, { phone: "71 99700-7002", name: "", text: "Oi Helena, tem sim!", fromMe: true });
  ageLead("+5571997007001", 11);
  await page.goto("/relatorios?aba=visao&periodo=hoje");
  await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
  const link = page.getByRole("navigation", { name: "Atalhos do resumo" }).getByRole("link", { name: /Ver atrasados/ });
  await expect(link).toBeVisible();
  await shot(page, "01-visao-geral-desktop", { fullPage: true });
  await link.click();
  await expect(page).toHaveURL(/\/funil\?filtro=atrasados/);
  await expect(page.getByRole("status").filter({ hasText: "Mostrando: leads atrasados" })).toBeVisible();
  await expect(page.getByText("Larissa Prado").first()).toBeVisible();
  await expect(page.getByText("Helena Duarte")).toHaveCount(0); // respondida: não está atrasada
  await page.getByRole("link", { name: "Mostrar todos" }).click();
  await expect(page.getByText("Helena Duarte").first()).toBeVisible();
});

test("abas e período ficam na URL; a análise mostra o que é da gestão só para a gestão", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios?periodo=hoje");
  await page.getByRole("tab", { name: "Análise" }).click();
  await expect(page).toHaveURL(/aba=analise/);
  await expect(page).toHaveURL(/periodo=hoje/);
  await expect(page.getByRole("heading", { name: "Quando as clientes escrevem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cada pessoa contra a meta" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  // Mapa de calor: rolagem só dentro do bloco, nunca na página.
  const region = page.getByRole("region", { name: /Mapa de calor/ });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await shot(page, "02-analise-desktop", { fullPage: true });
  await page.getByRole("tab", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/aba=visao/);
});

test("atendente não vê R$ nem os blocos da gestão", async ({ page }) => {
  await login(page, "ana@e2e.local");
  await page.goto("/relatorios?periodo=mes");
  await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Ticket médio" })).toHaveCount(0);
  await expect(page.getByText("Receita", { exact: true })).toHaveCount(0);
  await page.goto("/relatorios?aba=analise&periodo=mes");
  await expect(page.getByRole("heading", { name: "O follow-up funciona?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cada pessoa contra a meta" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toHaveCount(0);
  for (const t of SO_GESTAO) expect((await page.request.get(`/api/relatorios/${t}?periodo=mes`)).status()).toBe(403);
});

test("CSV de cada bloco abre no Excel; sem login é 401", async ({ page, playwright, baseURL }) => {
  await login(page);
  for (const t of [...TIPOS, ...SO_GESTAO]) {
    const res = await page.request.get(`/api/relatorios/${t}?periodo=mes`);
    expect(res.status(), t).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toMatch(new RegExp(`casa-fiaes-${t}-`));
    const text = await res.text();
    expect(text.charCodeAt(0), t).toBe(0xfeff);
    expect(text.split("\r\n")[0].length).toBeGreaterThan(5);
  }
  expect((await (await page.request.get("/api/relatorios/funil?periodo=mes")).text())).toContain("Marco;Leads;% dos leads novos");
  expect((await page.request.get("/api/relatorios/inexistente")).status()).toBe(404);
  // Sem cookie o proxy manda para o login; com cookie vencido ou falso quem responde é a própria rota (revalida a sessão).
  const anon = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: "cf_session=sessao-falsa" } });
  expect((await anon.get("/api/relatorios/funil")).status()).toBe(401);
  await anon.dispose();
});

test("o botão Exportar baixa o CSV do bloco", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios?periodo=mes");
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar CSV: primeira resposta" }).click();
  expect((await dl).suggestedFilename()).toMatch(/casa-fiaes-resposta-.*\.csv/);
});
