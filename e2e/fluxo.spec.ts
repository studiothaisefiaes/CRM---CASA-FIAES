import { test, expect } from "@playwright/test";
import { login, loginReal, simulate, ageLead } from "./helpers";

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

test("mensagem no WhatsApp vira lead, responder pelo card move para Atendimento", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99981-2244", name: "Mariana Couto", text: "Oi! Vim pelo Instagram, qual o valor?" });
  await page.goto("/funil");
  const lead = page.getByRole("region", { name: /^Lead,/ });
  await expect(lead.getByText("Mariana Couto")).toBeVisible();
  await expect(lead.getByText("Instagram", { exact: true })).toBeVisible();
  await lead.getByText("Mariana Couto").click();
  const sheet = page.getByRole("dialog", { name: /Lead Mariana Couto/ });
  await expect(sheet.getByText("Vim pelo Instagram")).toBeVisible();
  await sheet.getByLabel("Mensagem").fill("/aval");
  await sheet.getByRole("listbox", { name: "Respostas prontas" }).getByRole("option").first().click();
  await expect(sheet.getByLabel("Mensagem")).toHaveValue(/avaliação gratuita/);
  await page.waitForTimeout(500); // trava de revisão após preencher resposta pronta
  await sheet.getByLabel("Mensagem").press("Enter");
  await expect(sheet.getByLabel("Mensagem")).toHaveValue("");
  await expect(sheet.getByRole("combobox", { name: "Etapa" })).toHaveValue("atendimento");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /^Atendimento,/ }).getByText("Mariana Couto")).toBeVisible();
});

test("resposta pelo celular também conta", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 98877-1122", name: "Juliana Prado", text: "Boa tarde!" });
  await simulate(page, { phone: "71 98877-1122", name: "", text: "Oi Juliana!", fromMe: true });
  await page.goto("/funil");
  await expect(page.getByRole("region", { name: /^Atendimento,/ }).getByText("Juliana Prado")).toBeVisible();
});

test("lead sem resposta fica vermelho e gera alerta", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99123-4567", name: "Camila Santana", text: "Qual o valor das luzes?" });
  // Volta o relógio da espera em 11 minutos e roda o motor: a responsável é avisada aos 2 min e a gestão aos 10.
  ageLead("+5571991234567", 11);
  await page.goto("/funil");
  const card = page.getByRole("region", { name: /^Lead,/ }).getByRole("link", { name: /Camila Santana/ });
  await expect(card).toHaveClass(/border-alert/);
  await expect(page.getByRole("region", { name: /^Lead,/ })).toContainText(/atrasado/);
  await page.getByRole("button", { name: /Alertas, [1-9]/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Alertas" })).toContainText("Camila Santana");
});

test("agendar pede data e move para Agendado", async ({ page }) => {
  await login(page);
  await page.goto("/funil");
  await page.getByRole("region", { name: /^Atendimento,/ }).getByText("Mariana Couto").click();
  const sheet = page.getByRole("dialog", { name: /Lead Mariana Couto/ });
  await sheet.getByRole("combobox", { name: "Etapa" }).selectOption("agendado");
  const dlg = page.getByRole("dialog", { name: "Agendar avaliação" }); // a mesma folha da Fila
  await expect(dlg.getByLabel("Dia")).not.toHaveValue("");
  await dlg.getByRole("button", { name: "Agendar" }).click();
  await expect(sheet.getByRole("combobox", { name: "Etapa" })).toHaveValue("agendado");
});

test("fechar venda aceita 1158.50 e salva R$ 1.158,50", async ({ page }) => {
  await login(page);
  await page.goto("/funil");
  await page.getByRole("region", { name: /^Agendado,/ }).getByText("Mariana Couto").click();
  const sheet = page.getByRole("dialog", { name: /Lead Mariana Couto/ });
  await sheet.getByRole("combobox", { name: "Etapa" }).selectOption("fechado");
  const dlg = page.getByRole("dialog", { name: "Fechar venda" });
  await dlg.getByLabel("Valor").fill("abc");
  await dlg.getByRole("button", { name: "Fechar venda" }).click();
  await expect(dlg.getByRole("alert").first()).toBeVisible();
  await dlg.getByLabel("Valor").fill("1158.50");
  await dlg.getByRole("radio", { name: "Pix" }).click();
  await dlg.getByRole("radio", { name: "Coloração" }).click();
  await dlg.getByRole("button", { name: "Fechar venda" }).click();
  await expect(sheet.getByRole("combobox", { name: "Etapa" })).toHaveValue("fechado");
  await page.reload();
  await expect(page.getByRole("dialog", { name: /Lead Mariana Couto/ }).getByLabel("Valor (R$)")).toHaveValue("1.158,50");
});

test("campos do card salvam sozinhos e validam", async ({ page }) => {
  await login(page);
  await page.goto("/funil");
  await page.getByText("Juliana Prado").first().click();
  const sheet = page.getByRole("dialog", { name: /Lead Juliana Prado/ });
  const email = sheet.getByLabel("E-mail");
  await email.fill("nao-e-email"); await email.blur();
  await expect(sheet.getByText("E-mail inválido")).toBeVisible();
  await email.fill("juliana@email.com"); await email.blur();
  await expect(sheet.getByText("salvo")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: /Lead Juliana Prado/ }).getByLabel("E-mail")).toHaveValue("juliana@email.com");
});

test("atendente não acessa configurações", async ({ page }) => {
  await login(page, "ana@e2e.local");
  await expect(page.getByRole("link", { name: "Configurações" })).toHaveCount(0);
  await page.goto("/config/automacoes");
  await expect(page).toHaveURL(/aviso=sem-permissao/);
  await expect(page.getByText("Só a gestão tem acesso às configurações.")).toBeVisible();
});

test("gestão desliga e liga uma automação", async ({ page }) => {
  await login(page);
  await page.goto("/config/automacoes");
  const sw = page.getByRole("switch", { name: /Aniversário em 7 dias/ });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(page.getByText("Automação desligada")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: /Aniversário em 7 dias/ })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: /Aniversário em 7 dias/ }).click();
});

test("relatório exporta CSV que abre no Excel", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios");
  await expect(page.getByRole("heading", { name: "Do primeiro contato à venda" })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar" }).click().then(() => page.getByRole("link", { name: "Funil por marcos", exact: true }).click())]);
  expect(dl.suggestedFilename()).toMatch(/casa-fiaes-funil-.*\.csv/);
  const content = await (await dl.createReadStream()).toArray();
  const text = Buffer.concat(content).toString("utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("Marco;Leads;% dos leads novos");
});
