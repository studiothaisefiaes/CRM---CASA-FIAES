import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { e2eSql, login, shot } from "./helpers";

/**
 * Plano 4: Relatórios › Financeiro (CRM ao lado do Avec, Excel) e Caixa › Fechar o dia (3 passos, com o caixa no Avec e no CRM).
 * Dados com a marca "e2e-fin" e apagados no fim; o caixa volta para o CRM (o padrão do reset).
 */
test.describe.configure({ mode: "serial" });

const ANA = "ana@e2e.local";
const OFFSET_MS = 3 * 3_600_000;
const hoje = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
const id = async (q: string, p: unknown[] = []) => String((await e2eSql(q, p))[0].id);
const modo = (m: "avec" | "crm") => e2eSql("insert into settings (key, value) values ('caixa_modo', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value", [m]);

async function limpa() {
  await e2eSql("delete from comanda_payments where comanda_id in (select id from comandas where notes = 'e2e-fin')");
  await e2eSql("delete from comanda_items where comanda_id in (select id from comandas where notes = 'e2e-fin')");
  await e2eSql("delete from comandas where notes = 'e2e-fin'");
  await e2eSql("delete from cash_sessions where notes = 'e2e-fin'");
  for (const t of ["sales_items", "sales_payments", "appointments"]) await e2eSql(`delete from ${t} where external_key like 'e2e-fin:%'`);
  await e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);
  await e2eSql("delete from profiles where name = 'Relatórios sem valores (fin)'");
  await modo("crm");
}

test.beforeAll(async () => {
  await limpa();
  const gestora = await id("select id from users where email = 'gestao@e2e.local'");
  const maiara = await id("select id from professionals where name = 'Maiara'");
  // Avec de setembro: pagamentos e itens.
  await e2eSql(`insert into sales_payments (comanda_on, paid_on, comanda, client_name, method, value_cents, external_key) values
    ('2026-09-02', '2026-09-02', '501', 'Cliente Fin Um', 'Pix', 25000, 'e2e-fin:p1'),
    ('2026-09-02', '2026-09-02', '502', 'Cliente Fin Dois', 'Cartão Crédito (Visa)', 18000, 'e2e-fin:p2'),
    ('2026-09-03', '2026-09-03', '503', 'Cliente Fin Três', 'Dinheiro', 9000, 'e2e-fin:p3')`);
  await e2eSql(`insert into sales_items (sold_on, comanda, client_name, item, kind, category, professional_name, value_cents, discount_cents, total_cents, origin, external_key) values
    ('2026-09-02', '501', 'Cliente Fin Um', 'Corte Fin', 'servico', 'CABELO', 'MAIARA FIN', 25000, null, 25000, 'avec', 'e2e-fin:i1'),
    ('2026-09-02', '502', 'Cliente Fin Dois', 'Escova Fin', 'servico', 'CABELO', 'JO FIN', 20000, 2000, 18000, 'avec', 'e2e-fin:i2'),
    ('2026-09-03', '503', 'Cliente Fin Três', 'Hidratação Fin', 'servico', 'TRATAMENTO', 'MAIARA FIN', 9000, null, 9000, 'avec', 'e2e-fin:i3')`);
  // CRM de setembro: um caixa da gestora e uma comanda fechada nele, com desconto no item.
  const cx = await id(`insert into cash_sessions (day, status, opening_cents, opened_by, opened_at, closed_by, closed_at, difference_cents, notes)
    values ('2026-09-02', 'fechado', 10000, $1, '2026-09-02 12:00+00', $1, '2026-09-02 21:00+00', 0, 'e2e-fin') returning id`, [gestora]);
  const c = await id(`insert into comandas (day, number, status, client_name, total_cents, paid_cents, opened_by, closed_by, closed_at, cash_session_id, notes)
    values ('2026-09-02', 901, 'fechada', 'Cliente Fin Um', 22000, 22000, $1, $1, '2026-09-02 15:00+00', $2, 'e2e-fin') returning id`, [gestora, cx]);
  await e2eSql(`insert into comanda_items (comanda_id, kind, label, professional_id, qty, unit_cents, discount_cents, total_cents, added_by)
    values ($1, 'servico', 'Corte', $2, 1, 25000, 3000, 22000, $3)`, [c, maiara, gestora]);
  await e2eSql("insert into comanda_payments (comanda_id, method, value_cents, created_by, cash_session_id) values ($1, 'pix', 22000, $2, $3)", [c, gestora, cx]);
});
test.afterAll(limpa);

test("Financeiro: setembro com CRM ao lado do Avec, exceção, Excel com as 8 abas e sem rolagem lateral", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await page.goto("/relatorios?aba=financeiro&de=2026-09-01&ate=2026-09-30");
  await expect(page.getByRole("tab", { name: "Financeiro" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Formas de pagamento" })).toBeVisible();
  const formas = page.locator("#fin-formas-t").locator("xpath=ancestor::section");
  await expect(formas.getByRole("cell", { name: "Pix", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exceções" })).toBeVisible(); // Fase A (T11): a seção virou "Exceções" (nome único)
  await expect(page.getByText("Desconto no item").first()).toBeVisible();
  await expect(page.getByTestId("fonte-financeiro")).toContainText("Avec até");
  // Menu: Relatórios aceso; dentro da tela, a aba Financeiro.
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Relatórios" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tab", { name: "Financeiro" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "financeiro-relatorio", { fullPage: true });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar Excel" }).click()]);
  expect(download.suggestedFilename()).toBe("financeiro_2026-09-01_a_2026-09-30.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Painel", "Formas", "Caixas", "Vendas", "Itens", "Exceções", "Despesas", "Resultado"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Entradas" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "financeiro-relatorio-celular", { fullPage: true });
});

test("sem 'ver valores': a aba Financeiro cai na Visão geral e o Excel responde 403", async ({ browser, baseURL, isMobile }) => {
  test.skip(isMobile, "desktop");
  await e2eSql(`insert into profiles (name, permissions) values ('Relatórios sem valores (fin)', array['atendimento.ver','relatorios.ver','relatorios.equipe','relatorios.exportar']::text[])`);
  await e2eSql("update users set profile_id = (select id from profiles where name = 'Relatórios sem valores (fin)') where email = $1", [ANA]);
  const ctx = await browser.newContext({ baseURL, storageState: "e2e/.auth/ana.json" });
  const ana = await ctx.newPage();
  try {
    await ana.goto("/relatorios?aba=financeiro&de=2026-09-01&ate=2026-09-30");
    await expect(ana.getByRole("tab", { name: "Visão geral" })).toHaveAttribute("aria-selected", "true");
    await expect(ana.getByRole("tab", { name: "Financeiro" })).toHaveCount(0);
    expect((await ctx.request.get("/api/relatorios/excel-financeiro?de=2026-09-01&ate=2026-09-30")).status()).toBe(403);
  } finally { await ctx.close(); }
});

test("Fechar o dia com o caixa no Avec: sugestão do Avec, Compareceu em lote e o aviso no passo 3", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await modo("avec");
  const d = hoje();
  const maiara = await id("select id from professionals where name = 'Maiara'");
  const ap = await id(`insert into appointments (client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key)
    values ('Cliente Fin Hoje', $1, 'Corte', $2, 5, 'agendado', 'avec', 'e2e-fin:a1') returning id`, [maiara, `${d}T00:05:00-03:00`]);
  await e2eSql(`insert into sales_items (sold_on, comanda, client_name, item, kind, value_cents, total_cents, origin, external_key)
    values ($1, '77', 'Cliente Fin Hoje', 'Corte', 'servico', 12000, 12000, 'avec', 'e2e-fin:i9')`, [d]);
  await login(page);
  await page.goto("/caixa/fechar-dia");
  // Menu: com o caixa no Avec, o Caixa leva direto ao Fechar o dia e fica aceso; sem a aba Comandas.
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav.getByRole("link", { name: "Caixa" })).toHaveAttribute("href", "/caixa/fechar-dia");
  await expect(nav.getByRole("link", { name: "Caixa" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Caixa" }).getByRole("link", { name: "Comandas" })).toHaveCount(0);
  await expect(page.getByText("Cliente Fin Hoje")).toBeVisible();
  await expect(page.getByText("Avec: veio (tem comanda)")).toBeVisible();
  await page.getByRole("button", { name: /Selecionar as que o Avec diz que vieram/ }).click();
  await shot(page, "financeiro-fechar-dia-passo1");
  await page.getByRole("button", { name: "Veio", exact: true }).click();
  await expect(page.getByText("Cliente Fin Hoje")).toHaveCount(0);
  await expect.poll(async () => (await e2eSql("select status from appointments where id = $1", [ap]))[0].status).toBe("compareceu");
  await page.getByRole("link", { name: /3\s*Fechar o caixa/ }).click();
  await expect(page.getByRole("heading", { name: "O caixa ainda é no Avec." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toHaveCount(0);
  await shot(page, "financeiro-fechar-dia-passo3-avec");
});

test("Fechar o dia com o caixa no CRM: comanda aberta no passo 2 e fechar o caixa no passo 3", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await modo("crm");
  await e2eSql("update cash_sessions set status = 'fechado', closed_at = now() where status = 'aberto'");
  const gestora = await id("select id from users where email = 'gestao@e2e.local'");
  const cx = await id("insert into cash_sessions (day, status, opening_cents, opened_by, notes) values ($1, 'aberto', 10000, $2, 'e2e-fin') returning id", [hoje(), gestora]);
  const n = Number((await e2eSql("select coalesce(max(number), 0) + 1 as n from comandas where day = $1", [hoje()]))[0].n);
  const aberta = await id("insert into comandas (day, number, status, client_name, opened_by, notes) values ($1, $2, 'aberta', 'Cliente Fin Aberta', $3, 'e2e-fin') returning id", [hoje(), n, gestora]);
  // QA r58, I-8: comanda vazia nunca é pendência; a aberta do passo 2 tem um item.
  await e2eSql("insert into comanda_items (comanda_id, kind, label, qty, unit_cents, fiscal_kind, added_by) values ($1, 'produto', 'Kit Fin', 1, 3000, 'produto', $2)", [aberta, gestora]);
  await login(page);
  await page.goto("/caixa/fechar-dia?passo=2");
  // Com o caixa no CRM: Caixa aceso no menu; dentro, Comandas · Fechar o dia · Fechamentos, com Fechar o dia acesa.
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Caixa" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Fechar caixa / dia" })).toBeVisible();
  await expect(page.getByText(`Comanda ${n} · Cliente Fin Aberta`)).toBeVisible();
  await shot(page, "financeiro-fechar-dia-passo2-crm");
  await page.getByRole("link", { name: /3\s*Fechar o caixa/ }).click();
  await expect(page.getByText(/Aberto por Thaíse Fiaes/)).toBeVisible();
  await shot(page, "financeiro-fechar-dia-passo3-crm");
  // Caixa por pessoa: o passo 3 não mostra o esperado (contagem cega) e leva ao Caixa, onde ficam o fechamento e a aprovação.
  await expect(page.getByText(/esperado/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar meu caixa" }).click();
  const sheet = page.getByRole("dialog", { name: "Fechar caixa" });
  await sheet.getByLabel("Quantidade de R$ 100", { exact: true }).fill("1"); // o fundo de troco: diferença zero
  await sheet.getByRole("button", { name: "Fechar caixa" }).click();
  await expect.poll(async () => (await e2eSql("select status from cash_sessions where id = $1", [cx]))[0].status).toBe("fechado");
  await page.goto("/caixa/fechar-dia?passo=3");
  await expect(page.getByText("Você não tem caixa aberto agora.")).toBeVisible();
});
