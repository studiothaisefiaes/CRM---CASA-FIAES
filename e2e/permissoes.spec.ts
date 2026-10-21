import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, e2eSql } from "./helpers";

// A atendente do e2e (Ana) troca de perfil no meio do teste; no fim volta para "Atendente".
const ANA = "ana@e2e.local";
const voltaAna = () => e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);
const apagaPerfis = () => e2eSql("delete from profiles where not is_system");

async function semViolacoes(page: Page, rotulo: string) {
  await page.waitForTimeout(800);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id), rotulo).toEqual([]);
}

test.describe("permissões por perfil", () => {
  test.beforeEach(async () => { await voltaAna(); await apagaPerfis(); });
  test.afterEach(async () => { await voltaAna(); await apagaPerfis(); });

  test("gestão cria o perfil 'Só fila', dá para a Ana e ela só vê Atendimento (telas e API barradas no servidor)", async ({ page, browser }) => {
    await login(page);
    await page.goto("/config/equipe/perfis");
    await page.getByRole("button", { name: "Novo perfil" }).click();
    const form = page.getByRole("region", { name: "Novo perfil" });
    await form.getByLabel("Nome do perfil").fill("Só fila");
    await expect(form.getByRole("checkbox", { name: /Ver Conversas/ })).toBeChecked(); // vem marcado no perfil novo
    await semViolacoes(page, "editor de perfis");
    await form.getByRole("button", { name: "Criar perfil" }).click();
    await expect(page.getByText("Perfil criado")).toBeVisible();

    await page.goto("/config/equipe");
    await page.getByLabel("Perfil de Ana Souza").selectOption({ label: "Só fila" });
    await expect(page.getByText("Perfil alterado")).toBeVisible();

    const ctx = await browser.newContext();
    const ana = await ctx.newPage();
    try {
      await login(ana, ANA);
      const menu = ana.getByRole("navigation", { name: "Principal" }).first();
      await expect(menu.getByRole("link", { name: "Conversas", exact: true })).toBeVisible();
      for (const n of ["Clientes", "Relatórios", "Configurações"]) await expect(menu.getByRole("link", { name: n })).toHaveCount(0);
      await expect(ana.getByText("Só fila")).toBeVisible(); // o nome do perfil no rodapé do menu
      for (const path of ["/relatorios", "/contatos", "/config/automacoes", "/funil", "/jornada"]) {
        await ana.goto(path);
        await expect(ana, path).toHaveURL(/\/\?aviso=sem-permissao/);
      }
      await expect(ana.getByText("Você não tem acesso a essa tela.", { exact: false })).toBeVisible();
      const api = await ana.request.get("/api/relatorios/numeros?periodo=mes");
      expect(api.status()).toBe(403);
      await ana.goto("/atendimento");
      await expect(ana.getByRole("heading", { name: "Conversas", level: 1 })).toBeVisible();
      await expect(ana.getByRole("link", { name: "Quadro" })).toHaveCount(0); // aba do Quadro some sem a permissão
    } finally { await ctx.close(); }
  });

  test("travas: perfil Gestão não edita, perfil padrão não apaga, ninguém tira o próprio acesso de gerir", async ({ page }) => {
    await login(page);
    await page.goto("/config/equipe/perfis");
    await page.getByRole("button", { name: /^Gestão/ }).click();
    const gest = page.getByRole("region", { name: "Perfil Gestão" });
    await expect(gest.getByText("Gestão sempre tem acesso a tudo", { exact: false })).toBeVisible();
    await expect(gest.getByRole("checkbox").first()).toBeDisabled();
    await expect(gest.getByRole("button", { name: "Apagar" })).toHaveCount(0);

    await page.getByRole("button", { name: /^Atendente/ }).click();
    await expect(page.getByRole("region", { name: "Perfil Atendente" }).getByRole("button", { name: "Apagar" })).toHaveCount(0); // perfil padrão

    await page.goto("/config/equipe");
    await page.getByLabel("Perfil de Thaíse Fiaes").selectOption({ label: "Recepção" });
    await expect(page.getByText("Você não pode tirar o próprio acesso de gerir a equipe.")).toBeVisible();
  });

  test("atendente padrão pode transferir (pedido da Casa)", async ({ page }) => {
    const [row] = await e2eSql(`insert into contacts (name, phone_e164) values ('Tina Transfer', '+5571997888001') returning id`);
    const [st] = await e2eSql("select id from stages where key = 'lead'");
    const [ana] = await e2eSql("select id from users where email = $1", [ANA]);
    const [deal] = await e2eSql("insert into deals (contact_id, stage_id, owner_id, origin) values ($1, $2, $3, 'whatsapp') returning id", [row.id, st.id, ana.id]);
    try {
      await login(page, ANA);
      await page.goto(`/atendimento/${deal.id}/cliente`);
      // No computador quem cuida fica no cabeçalho da conversa ("Com: Ana" ▾ para passar).
      await expect(page.getByRole("button", { name: "Com Ana Souza. Passar para…" })).toBeVisible();
    } finally {
      await e2eSql("delete from deals where id = $1", [deal.id]);
      await e2eSql("delete from contacts where id = $1", [row.id]);
    }
  });
});
