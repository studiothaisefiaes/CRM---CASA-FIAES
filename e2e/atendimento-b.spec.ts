import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql } from "./helpers";

// Formato B (escolhido pela Casa): "Quem é" com o que o CRM sabe da cliente; valores só para quem pode; palavras-chave da gestão.
const ANA = "ana@e2e.local";
const voltaAna = () => e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);

test.describe("atendimento no formato B", () => {
  test.skip(({ isMobile }) => isMobile, "desktop");
  test.afterEach(voltaAna);

  test("aba Cliente: visitas e total gasto para a gestão; perfil sem venda nem valores vê as visitas mas nenhum R$", async ({ page, browser }) => {
    await login(page);
    await simulate(page, { phone: "71 99703-0001", name: "Vera Visitas", text: "Oi, quero voltar" });
    const [c] = await e2eSql("select id from contacts where phone_e164 = '+5571997030001'");
    const [fechado] = await e2eSql("select id from stages where key = 'fechado'");
    await e2eSql(`insert into deals (contact_id, stage_id, closed_at, created_at, value_cents, scheduled_at, attendance)
      values ($1, $2, now() - interval '40 days', now() - interval '41 days', 25000, now() - interval '40 days', 'compareceu')`, [c.id, fechado.id]);
    const [lead] = await e2eSql("select d.id from deals d where d.contact_id = $1 and d.closed_at is null", [c.id]);
    await page.goto(`/atendimento?lead=${lead.id}`);
    const painel = page.getByRole("region", { name: "Dados do cliente" });
    await painel.getByRole("tab", { name: "Cliente" }).click();
    const quem = painel.getByRole("tabpanel", { name: "Cliente" });
    await expect(quem.getByRole("term").filter({ hasText: "Visitas" }).locator("xpath=..").getByRole("definition")).toHaveText("1");
    await expect(quem.getByText("R$ 250,00")).toBeVisible();

    await e2eSql("insert into profiles (name, permissions, is_system) values ('Sem valores e2e', '{atendimento.ver,atendimento.todas}', false) on conflict do nothing");
    await e2eSql("update users set profile_id = (select id from profiles where name = 'Sem valores e2e') where email = $1", [ANA]);
    const ctx = await browser.newContext();
    const ana = await ctx.newPage();
    try {
      await login(ana, ANA);
      await ana.goto(`/atendimento?lead=${lead.id}`);
      const p2 = ana.getByRole("region", { name: "Dados do cliente" });
      await p2.getByRole("tab", { name: "Cliente" }).click();
      const q2 = p2.getByRole("tabpanel", { name: "Cliente" });
      await expect(q2.getByRole("term").filter({ hasText: "Visitas" }).locator("xpath=..").getByRole("definition")).toHaveText("1");
      await expect(q2.getByText("Total gasto")).toHaveCount(0);
      await expect(q2.getByText(/R\$/)).toHaveCount(0);
    } finally {
      await ctx.close();
      await e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);
      await e2eSql("delete from profiles where name = 'Sem valores e2e'");
    }
  });

  test("palavra-chave criada em Listas é guardada; o cartão fino da Fila não mostra mais etiqueta automática (pedido do dono, 16/10)", async ({ page }) => {
    await e2eSql("delete from lists where kind = 'keyword'");
    await login(page);
    await page.goto("/config/listas?aba=keyword"); // F5: item "Palavras que viram etiqueta", já aberto na lista certa
    await expect(page.getByRole("heading", { name: "Palavras que viram etiqueta", level: 1 })).toBeVisible();
    await page.getByLabel("Etiqueta").fill("Mega hair");
    await page.getByLabel("Palavras ou frases (uma por linha)").fill("mega hair\naplique");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Adicionado")).toBeVisible();
    await simulate(page, { phone: "71 99703-0002", name: "Ana Aplique", text: "Vocês colocam aplique?" });
    await page.goto("/atendimento");
    await expect(page.getByRole("option", { name: /Ana Aplique/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Ana Aplique/ })).not.toContainText("Mega hair");
    await e2eSql("delete from lists where kind = 'keyword'");
  });
});
