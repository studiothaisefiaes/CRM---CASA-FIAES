import { test, expect } from "@playwright/test";
import { login, e2eSql } from "./helpers";

test.describe.configure({ mode: "serial" });

const ANA = "ana@e2e.local";
const limpa = async () => {
  for (const t of ["sales_items", "sales_payments", "appointments"]) await e2eSql(`delete from ${t} where external_key like 'e2e-salao:%'`);
  await e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);
  await e2eSql("delete from profiles where name = 'Relatórios sem valores'");
};

test.beforeAll(async () => {
  await limpa();
  await e2eSql(`insert into sales_items (sold_on, comanda, item, kind, category, professional_name, value_cents, total_cents, origin, external_key) values
    ('2026-09-02', '501', 'Corte Teste', 'servico', 'CABELO', 'MAIARA TESTE', 25000, 25000, 'avec', 'e2e-salao:1'),
    ('2026-09-03', '502', 'Escova Teste', 'servico', 'CABELO', 'JO TESTE', 12345, 12345, 'avec', 'e2e-salao:2')`);
  await e2eSql(`insert into sales_payments (comanda_on, paid_on, comanda, method, value_cents, external_key) values ('2026-09-02', '2026-09-02', '501', 'Pix', 25000, 'e2e-salao:p1')`);
  await e2eSql(`insert into appointments (service_label, starts_at, status, external_key) values
    ('Corte Teste', '2026-09-02 13:00+00', 'compareceu', 'e2e-salao:a1'), ('Escova Teste', '2026-09-05 13:00+00', 'agendado', 'e2e-salao:a2')`);
});
test.afterAll(limpa);

test("gestão vê o Salão de setembro: faturamento, profissional, agenda sem desfecho e a fonte do Avec, sem rolagem lateral", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios?aba=salao&de=2026-09-01&ate=2026-09-30");
  await expect(page.getByRole("tab", { name: "Salão" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Faturamento" })).toBeVisible();
  await expect(page.getByText(/R\$\s373,45/).first()).toBeVisible();
  await expect(page.getByText("MAIARA TESTE").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agenda sem desfecho" })).toBeVisible();
  await expect(page.getByTestId("fonte-salao")).toContainText("Fonte: Avec até");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("perfil com Relatórios mas sem 'ver valores': o Salão mostra só quantidades", async ({ browser, baseURL }) => {
  await e2eSql(`insert into profiles (name, permissions) values ('Relatórios sem valores', array['atendimento.ver','relatorios.ver','relatorios.equipe']::text[])`);
  await e2eSql("update users set profile_id = (select id from profiles where name = 'Relatórios sem valores') where email = $1", [ANA]);
  const ctx = await browser.newContext({ baseURL, storageState: "e2e/.auth/ana.json" });
  const ana = await ctx.newPage();
  try {
    await ana.goto("/relatorios?aba=salao&de=2026-09-01&ate=2026-09-30");
    await expect(ana.getByRole("heading", { name: "Comandas" })).toBeVisible();
    await expect(ana.getByText("MAIARA TESTE").first()).toBeVisible();
    expect(await ana.locator("main").innerText()).not.toMatch(/R\$/);
  } finally { await ctx.close(); }
});
