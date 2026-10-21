import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// Menu lateral sem subtópicos (pedido do dono, 18/10): a troca de visões mora dentro de cada tela.
test.describe("menu limpo", () => {
  test.skip(({ isMobile }) => isMobile, "desktop");

  test("o menu tem uma linha por item e nenhuma lista aninhada, em qualquer tela", async ({ page }) => {
    await login(page);
    for (const path of ["/", "/atendimento", "/agenda", "/caixa", "/contatos", "/relatorios", "/servicos"]) {
      await page.goto(path);
      const menu = page.getByRole("navigation", { name: "Principal" }).first();
      await expect(menu.getByRole("link"), path).toHaveText(["Hoje", "Conversas", "Agenda", "Caixa", "Clientes", "Relatórios", "Serviços e pacotes", "Configurações"]);
      await expect(menu.getByRole("list")).toHaveCount(0);
    }
  });

  test("Hoje: Resumo · Recepção · Ao vivo dentro da tela", async ({ page }) => {
    await login(page);
    await page.goto("/");
    const abas = page.getByRole("navigation", { name: "Hoje" });
    await expect(abas.getByRole("link")).toHaveText(["Resumo", "Recepção", "Ao vivo"]);
    await expect(abas.getByRole("link", { name: "Resumo" })).toHaveAttribute("aria-current", "page");
    await abas.getByRole("link", { name: "Recepção" }).click();
    await expect(page).toHaveURL(/\/\?vista=recepcao$/);
    await expect(page.getByRole("navigation", { name: "Hoje" }).getByRole("link", { name: "Recepção" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: "Hoje" }).getByRole("link", { name: "Ao vivo" }).click();
    await expect(page).toHaveURL(/\/ao-vivo$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Hoje" })).toHaveAttribute("aria-current", "page");
  });

  test("Clientes: Clientes · Com pacote · Fidelidade; Serviços e pacotes sem Clientes com pacote", async ({ page }) => {
    await login(page);
    await page.goto("/contatos");
    const abas = page.getByRole("navigation", { name: "Clientes" });
    await expect(abas.getByRole("link")).toHaveText(["Clientes", "Com pacote", "Fidelidade"]);
    await abas.getByRole("link", { name: "Com pacote" }).click();
    await expect(page).toHaveURL(/\/contatos\?vista=pacote$/);
    await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Clientes" }).getByRole("link", { name: "Fidelidade" }).click();
    await expect(page).toHaveURL(/vista=fidelidade$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    await page.goto("/servicos");
    await expect(page.getByRole("navigation", { name: "Serviços e pacotes" }).getByRole("link", { name: /Clientes com pacote/ })).toHaveCount(0);
    await page.goto("/servicos?aba=clientes&situacao=todos");
    await expect(page).toHaveURL(/\/contatos\?vista=pacote&situacao=todos$/);
  });

  test("Relatórios: as visões da tela são abas; Comissão, Jornada e Avec abrem por Mais relatórios", async ({ page }) => {
    await login(page);
    await page.goto("/relatorios");
    await expect(page.getByRole("tablist", { name: "Seção do relatório" }).getByRole("tab")).toHaveText(["Visão geral", "Salão", "Análise", "Financeiro"]);
    await page.getByRole("link", { name: "Comissão", exact: true }).click();
    await expect(page).toHaveURL(/\/caixa\/comissao$/);
    await expect(page.getByRole("main").getByRole("link", { name: "Relatórios", exact: true })).toHaveAttribute("href", "/relatorios"); // "‹ Relatórios" do cabeçalho
    await page.goto("/relatorios");
    await page.getByRole("link", { name: "Abrir Relatórios do Avec" }).click();
    await expect(page).toHaveURL(/\/relatorios\/avec$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Relatórios" })).toHaveAttribute("aria-current", "page");
  });

  test("Caixa com abas de verdade (Caixa · Caixas da equipe) e Fechamentos dentro de Fechar caixa / dia", async ({ page }) => {
    await login(page);
    await page.goto("/caixa");
    const links = page.getByRole("navigation", { name: "Caixa" });
    await expect(links.getByRole("link")).toHaveText(["Caixa", "Caixas da equipe"]); // dsgfix r68 #4: abas, não texto solto
    // Caixa fechado: só "Abrir caixa" (e o aviso); "Fechar caixa / dia" só existe com o caixa aberto.
    await expect(page.getByRole("link", { name: "Fechar caixa / dia" })).toHaveCount(0);
    await page.getByLabel("Fundo de troco (R$)").fill("0");
    await page.getByRole("button", { name: /^Abrir caixa, / }).click();
    await page.getByRole("link", { name: "Fechar caixa / dia" }).click();
    await expect(page).toHaveURL(/\/caixa\/fechar-dia$/);
    await expect(page.getByRole("region", { name: "Histórico de fechamentos" })).toBeVisible();
    await page.goto("/caixa/fechamentos"); // a rota antiga leva para o histórico dentro de Fechar caixa / dia
    await expect(page).toHaveURL(/\/caixa\/fechar-dia#historico$/);
    await page.goto("/caixa");
    await page.getByRole("navigation", { name: "Caixa" }).getByRole("link", { name: "Caixas da equipe" }).click();
    await expect(page).toHaveURL(/\/caixa\/equipe$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Caixa" })).toHaveAttribute("aria-current", "page");
  });
});
