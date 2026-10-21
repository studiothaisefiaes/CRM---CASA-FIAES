import { test, expect } from "@playwright/test";
import { login, loginReal, simulate, ageLead, e2eSql } from "./helpers";

// Lote 6B: no modo "consulta" (o de produção até o dono escolher), "Agendar horário" na conversa continua a folha antiga (decisão 2 do plano).
test.beforeAll(async () => { await e2eSql(`insert into settings (key, value) values ('agenda_modo', '"consulta"') on conflict (key) do update set value = excluded.value`); });
test.afterAll(async () => { await e2eSql(`update settings set value = '"dupla"' where key = 'agenda_modo'`); });

test.describe.configure({ mode: "serial" });

test("login com senha errada mostra erro claro", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("gestao@e2e.local");
  await page.getByLabel("Senha").fill("errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." })).toBeVisible();
});

test("login de verdade pelo formulário entra no Hoje", async ({ page }) => {
  await loginReal(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("rota protegida sem login vai para o login", async ({ page }) => {
  await page.goto("/funil");
  await expect(page).toHaveURL(/\/login\?voltar=%2Ffunil/);
});

test("mensagem no WhatsApp vira lead, responder pelo card move para Em conversa", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99981-2244", name: "Mariana Couto", text: "Oi! Vim pelo Instagram, qual o valor?" });
  await page.goto("/funil");
  const lead = page.getByRole("region", { name: /^Novo contato,/ });
  await expect(lead.getByText("Mariana Couto")).toBeVisible();
  await expect(lead.getByText("Instagram", { exact: true })).toBeVisible();
  await lead.getByText("Mariana Couto").click();
  const sheet = page.getByRole("dialog", { name: /Conversa com Mariana Couto/ });
  await expect(sheet.getByText("Vim pelo Instagram")).toBeVisible();
  await sheet.getByLabel("Mensagem", { exact: true }).fill("/aval");
  await sheet.getByRole("listbox", { name: "Respostas prontas" }).getByRole("option").first().click();
  await expect(sheet.getByLabel("Mensagem", { exact: true })).toHaveValue(/Método Fiaes® começa por uma avaliação/);
  await page.waitForTimeout(500); // trava de revisão após preencher resposta pronta
  await sheet.getByLabel("Mensagem", { exact: true }).press("Enter");
  await expect(sheet.getByLabel("Mensagem", { exact: true })).toHaveValue("");
  // O Quadro abre o mesmo painel da Fila (Plano 5): a etapa fica na faixa do cabeçalho.
  await expect(sheet.getByTestId("faixa-conversa")).toContainText("Em conversa");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /^Em conversa,/ }).getByText("Mariana Couto")).toBeVisible();
});

test("resposta pelo celular também conta", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 98877-1122", name: "Juliana Prado", text: "Boa tarde!" });
  await simulate(page, { phone: "71 98877-1122", name: "", text: "Oi Juliana!", fromMe: true });
  await page.goto("/funil");
  await expect(page.getByRole("region", { name: /^Em conversa,/ }).getByText("Juliana Prado")).toBeVisible();
});

test("lead sem resposta fica vermelho e gera alerta", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99123-4567", name: "Camila Santana", text: "Qual o valor das luzes?" });
  // Volta o relógio da espera em 31 minutos e roda o motor: a responsável é avisada aos 2 min e a gestão aos 30 (Lote 0).
  ageLead("+5571991234567", 31);
  await page.goto("/funil");
  const card = page.getByRole("region", { name: /^Novo contato,/ }).getByRole("link", { name: /Camila Santana/ });
  await expect(card).toHaveClass(/border-alert/);
  await expect(page.getByRole("region", { name: /^Novo contato,/ })).toContainText(/atrasado/);
  await page.getByRole("button", { name: /Alertas, [1-9]/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Alertas" })).toContainText("Camila Santana");
});

test("agendar pede data e move para Agendado", async ({ page }) => {
  await login(page);
  await page.goto("/funil");
  await page.getByRole("region", { name: /^Em conversa,/ }).getByText("Mariana Couto").click();
  const sheet = page.getByRole("dialog", { name: /Conversa com Mariana Couto/ });
  await sheet.getByRole("button", { name: "Agendar horário" }).click(); // o painel da Fila › Agora › O que fazer
  const dlg = page.getByRole("dialog", { name: "Agendar avaliação" }); // a mesma folha da Fila
  await expect(dlg.getByLabel("Dia")).not.toHaveValue("");
  await dlg.getByRole("button", { name: "Agendar" }).click();
  await expect(sheet.getByTestId("faixa-conversa")).toContainText("Agendado");
});

test("Editar dados pelo painel do Quadro salva o e-mail", async ({ page }) => {
  // Plano 5: o LeadSheet (campos que salvavam sozinhos, Valor) saiu; o Quadro usa o Editar dados do painel da Fila.
  await login(page);
  await page.goto("/funil");
  await page.getByText("Juliana Prado").first().click();
  const sheet = page.getByRole("dialog", { name: /Conversa com Juliana Prado/ });
  await sheet.getByRole("tab", { name: "Cliente" }).click();
  await sheet.getByRole("button", { name: "Editar dados" }).click();
  const dlg = page.getByRole("dialog", { name: /Dados de Juliana/ });
  await dlg.getByLabel("E-mail").fill("juliana@email.com");
  await dlg.getByRole("button", { name: "Salvar dados" }).click();
  await expect(dlg).toBeHidden();
  await page.reload();
  const again = page.getByRole("dialog", { name: /Conversa com Juliana Prado/ });
  await again.getByRole("tab", { name: "Cliente" }).click();
  await expect(again.getByRole("region", { name: "Dados da cliente" })).toContainText("juliana@email.com");
});

test("atendente não acessa as configurações do sistema", async ({ page }) => {
  await login(page, "ana@e2e.local"); // Lote 4: a atendente tem o dia a dia (Configurações aparece), não o sistema
  await page.goto("/config/automacoes");
  await expect(page).toHaveURL(/aviso=sem-permissao/);
  await expect(page.getByText("Você não tem acesso a essa tela.", { exact: false })).toBeVisible();
});

test("gestão desliga e liga uma automação", async ({ page }) => {
  await login(page);
  await page.goto("/config/automacoes");
  const sw = page.getByRole("switch", { name: /Aniversário em 7 dias/ });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  // Toque antes da hidratação (dev server compilando a rota) não chega ao React: tenta de novo só enquanto não houve o aviso.
  await expect(async () => {
    if (!(await page.getByText("Automação desligada").isVisible())) await sw.click();
    await expect(page.getByText("Automação desligada")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("switch", { name: /Aniversário em 7 dias/ })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: /Aniversário em 7 dias/ }).click();
});

test("relatório exporta CSV que abre no Excel", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios");
  await expect(page.getByRole("heading", { name: "Do primeiro contato à venda" })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar" }).click().then(() => page.getByRole("link", { name: "Do primeiro contato à venda", exact: true }).click())]);
  expect(dl.suggestedFilename()).toMatch(/casa-fiaes-funil-.*\.csv/);
  const content = await (await dl.createReadStream()).toArray();
  const text = Buffer.concat(content).toString("utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("Marco;Conversas;% das conversas novas");
});
