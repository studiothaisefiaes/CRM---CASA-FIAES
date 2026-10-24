import { test, expect } from "@playwright/test";
import { e2eSql, login } from "./helpers";

// Sistema de design (dsgfix, r68): prova na tela das correções do relatório de design e da análise psicológica.
let antes: Record<string, unknown>[] | null = null;
async function caixaNoCrm() {
  antes = await e2eSql("select value from settings where key = 'caixa_modo'");
  await e2eSql(`insert into settings (key, value) values ('caixa_modo', '"crm"') on conflict (key) do update set value = excluded.value`);
  await e2eSql("update cash_sessions set status = 'fechado', closed_at = now() where status = 'aberto'");
}
// Devolve o modo do caixa como estava: os outros specs não podem herdar o caixa ligado (comandas criadas na chegada travam a limpeza deles).
test.afterEach(async () => {
  if (!antes) return;
  if (antes.length) await e2eSql("update settings set value = $1 where key = 'caixa_modo'", [JSON.stringify(antes[0].value)]);
  else await e2eSql("delete from settings where key = 'caixa_modo'");
  antes = null;
});

test("404 em português, com a marca e a saída para o Hoje (r68 #1)", async ({ page }) => {
  await login(page);
  await page.goto("/esta-pagina-nao-existe");
  await expect(page.getByRole("heading", { level: 1, name: "Esta página não existe" })).toBeVisible();
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
  await page.getByRole("link", { name: "Voltar para o Hoje" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("título de página único: mesmo tamanho e peso em Caixa, Clientes, Serviços, Relatórios e Configurações (r68 #2)", async ({ page, isMobile }) => {
  test.skip(isMobile, "computador");
  await login(page);
  const estilos = [];
  for (const path of ["/caixa", "/contatos", "/servicos", "/relatorios", "/config/funcoes"]) {
    await page.goto(path);
    const h1 = page.getByRole("heading", { level: 1 }).first();
    estilos.push(await h1.evaluate((e) => { const s = getComputedStyle(e); return `${s.fontSize}/${s.fontWeight}`; }));
  }
  expect(new Set(estilos)).toEqual(new Set(["32px/400"]));
  // nada abaixo de 12 px na tela de Relatórios
  await page.goto("/relatorios");
  const menor = await page.evaluate(() => Math.min(...[...document.querySelectorAll("main *")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
    .map((e) => parseFloat(getComputedStyle(e).fontSize))));
  expect(menor).toBeGreaterThanOrEqual(12);
});

test("Relatórios: abas logo abaixo do título e filtros/exportação numa linha própria, não na linha do título (r68 #6)", async ({ page, isMobile }) => {
  test.skip(isMobile, "computador");
  await login(page);
  await page.goto("/relatorios");
  const header = page.locator("[data-page-header]");
  const titulo = await header.getByRole("heading", { level: 1 }).boundingBox();
  const abas = await header.getByRole("tablist", { name: "Seção do relatório" }).boundingBox();
  const linha = await header.locator("[data-page-toolbar]").boundingBox();
  expect(abas!.y).toBeGreaterThan(titulo!.y + titulo!.height - 1);
  expect(linha!.y).toBeGreaterThan(abas!.y + abas!.height - 1);
  await expect(header.locator("[data-page-toolbar]").getByRole("tab", { name: "Mês" })).toBeVisible();
});

test("Caixa fechado: só o convite para abrir, sem comanda nem vermelho; o Hoje lembra com 'Abrir caixa' (r68 #5, psico #6)", async ({ page }) => {
  await caixaNoCrm();
  await login(page);
  await page.goto("/?vista=resumo");
  await expect(page.getByRole("status").filter({ hasText: "O caixa está fechado." })).toBeVisible();
  await page.getByRole("link", { name: "Abrir caixa" }).click();
  await expect(page).toHaveURL(/\/caixa$/);
  await expect(page.getByRole("heading", { name: "Seu caixa está fechado" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Receber/ })).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  // Abas de verdade no Caixa
  await expect(page.getByRole("navigation", { name: "Caixa" }).getByRole("link")).toHaveText(["Caixa", "Caixas da equipe"]);
});

test("Recursos: acordeão com só a primeira seção aberta e nenhum 'Salvar' cinza parado (r68 #9, #10)", async ({ page, isMobile }) => {
  test.skip(isMobile, "computador");
  await login(page);
  await page.goto("/config/funcoes");
  const abertas = await page.locator("main details").evaluateAll((ds) => ds.map((d) => (d as HTMLDetailsElement).open));
  expect(abertas[0]).toBe(true);
  expect(abertas.slice(1).every((o) => !o)).toBe(true);
  await expect(page.getByRole("button", { name: /^Salvar/ })).toHaveCount(0);
});

test("celular: Clientes sem rolagem lateral da página; os chips rolam só dentro da faixa (r68 #21)", async ({ page, isMobile }) => {
  test.skip(!isMobile, "celular");
  await login(page);
  await page.goto("/contatos");
  const { pagina, janela } = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, janela: innerWidth }));
  expect(pagina).toBeLessThanOrEqual(janela);
  const faixa = page.getByRole("navigation", { name: "Filtros" });
  expect(await faixa.evaluate((e) => getComputedStyle(e).overflowX)).toBe("auto");
});
