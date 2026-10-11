import { test, expect, type Page } from "@playwright/test";
import { login, e2eSql, shot } from "./helpers";

test.describe.configure({ mode: "serial" });

const MODELO = "Parabéns no aniversário";
const limpa = async () => {
  await e2eSql("delete from automations where name = $1", [MODELO]);
  await e2eSql("delete from settings where key in ('auto_resposta', 'envio_teto_hora', 'retencao_midia_meses')");
  await e2eSql("delete from channels where instance_name like 'e2e-cfg-%'");
  await e2eSql("update lists set cycle_days = null where kind = 'service' and label = 'Corte'");
};
test.beforeEach(limpa);
test.afterAll(limpa);

const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("modelo cria a automação desligada; ligar mostra o aviso e cancelar mantém desligada", async ({ page }) => {
  await login(page);
  await page.goto("/config/automacoes");
  await page.getByRole("button", { name: "Começar de um modelo" }).click();
  await expect(page.getByTestId("modelos").getByRole("button")).toHaveCount(8);
  await shot(page, "01-automacoes-modelos");
  await page.getByTestId("modelo-aniversario").click();
  await expect(page.getByRole("dialog", { name: "Editar automação" })).toBeVisible();
  const [criada] = await e2eSql("select id, enabled from automations where name = $1", [MODELO]);
  expect(criada.enabled).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Editar automação" })).toHaveCount(0);

  const sw = page.getByRole("switch", { name: `Ligar ${MODELO}` });
  await sw.click();
  const aviso = page.getByRole("dialog", { name: "Ligar o envio automático?" });
  await expect(aviso).toContainText("Isto vai enviar mensagens reais para clientes.");
  await shot(page, "02-dialogo-envio-real");
  await aviso.getByRole("button", { name: "Cancelar" }).click();
  await expect(aviso).toHaveCount(0);
  expect((await e2eSql("select enabled from automations where name = $1", [MODELO]))[0].enabled).toBe(false);

  await sw.click();
  await aviso.getByRole("button", { name: "Entendi, ligar" }).click();
  await expect(page.getByRole("switch", { name: `Desligar ${MODELO}` })).toBeVisible();
  expect((await e2eSql("select enabled from automations where name = $1", [MODELO]))[0].enabled).toBe(true);
  const [aud] = await e2eSql("select user_id, data from audit_log where entity = 'automation' and action = 'ligou' and entity_id = $1", [criada.id]);
  expect(aud.user_id).not.toBeNull();
  expect(aud.data).toMatchObject({ envia: true });
  await e2eSql("update automations set enabled = false where name = $1", [MODELO]);
});

test("salvar automação já ligada que passa a ter envio pede o aviso", async ({ page }) => {
  await login(page);
  await e2eSql(`insert into automations (name, enabled, trigger, conditions, actions) values ($1, true, '{"type":"parado_dias","days":3}', '[]', '[{"type":"alertar_responsavel","message":"{nome} parado"}]')`, [MODELO]);
  await page.goto("/config/automacoes");
  const card = page.locator("li", { hasText: MODELO });
  await card.getByRole("button", { name: "Editar" }).click();
  const ed = page.getByRole("dialog", { name: "Editar automação" });
  await ed.getByRole("button", { name: "Salvar" }).click(); // sem envio: salva direto
  await expect(page.getByText("Automação salva")).toBeVisible();
  await card.getByRole("button", { name: "Editar" }).click();
  await ed.locator("select").nth(1).selectOption("enviar_mensagem");
  await ed.getByRole("button", { name: "Salvar" }).click();
  const aviso = page.getByRole("dialog", { name: "Ligar o envio automático?" });
  await expect(aviso).toBeVisible();
  await aviso.getByRole("button", { name: "Cancelar" }).click();
  const [a] = await e2eSql("select actions from automations where name = $1", [MODELO]);
  expect(JSON.stringify(a.actions)).not.toContain("enviar_mensagem");
  await ed.getByRole("button", { name: "Salvar" }).click();
  await aviso.getByRole("button", { name: "Entendi, ligar" }).click();
  await expect.poll(async () => JSON.stringify((await e2eSql("select actions from automations where name = $1", [MODELO]))[0].actions)).toContain("enviar_mensagem");
});

test("resposta fora do horário: prévia, aviso ao ligar, cancelar mantém desligada", async ({ page }) => {
  await login(page);
  await page.goto("/config/mensagens");
  await expect(page.getByTestId("nota-expediente")).toContainText("24 horas");
  const texto = page.getByLabel("Texto da resposta");
  await texto.fill("Oi, {nome}! Estamos fechados agora e respondemos assim que abrir.");
  await expect(page.getByTestId("previa-resposta")).toHaveText("Oi, Maria! Estamos fechados agora e respondemos assim que abrir.");
  await page.getByRole("button", { name: "Salvar texto" }).click();
  await expect(page.getByText("Texto salvo. A resposta continua desligada")).toBeVisible();
  expect((await e2eSql("select value from settings where key = 'auto_resposta'"))[0].value).toMatchObject({ enabled: false });
  await shot(page, "03-resposta-fora-do-horario");

  const sw = page.getByRole("switch", { name: "Ligar a resposta fora do horário" });
  await sw.click();
  const aviso = page.getByRole("dialog", { name: "Ligar o envio automático?" });
  await expect(aviso).toContainText("Isto vai enviar mensagens reais para clientes.");
  await aviso.getByRole("button", { name: "Cancelar" }).click();
  expect((await e2eSql("select value from settings where key = 'auto_resposta'"))[0].value).toMatchObject({ enabled: false });
  await sw.click();
  await aviso.getByRole("button", { name: "Entendi, ligar" }).click();
  await expect(page.getByRole("switch", { name: "Desligar a resposta fora do horário" })).toBeVisible();
  expect((await e2eSql("select value from settings where key = 'auto_resposta'"))[0].value).toMatchObject({ enabled: true });
  const [aud] = await e2eSql("select user_id from audit_log where entity = 'settings' and entity_id = 'auto_resposta' and action = 'ligou'");
  expect(aud.user_id).not.toBeNull();
  await page.getByRole("switch", { name: "Desligar a resposta fora do horário" }).click();
  await expect(page.getByRole("switch", { name: "Ligar a resposta fora do horário" })).toBeVisible();
});

test("WhatsApp: teto por hora, prazo das mídias e modo quieto por número", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status, quiet_until) values ('Salão', 'e2e-cfg-1', 'conectado', now() + interval '30 hours')");
  await login(page);
  await page.goto("/config/whatsapp");
  const campo = page.getByLabel("Mensagens por hora (1 a 200)");
  await expect(campo).toHaveValue("30");
  await campo.fill("0");
  await page.getByRole("button", { name: "Salvar limite" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "O mínimo é 1 por hora." })).toBeVisible();
  await campo.fill("201");
  await page.getByRole("button", { name: "Salvar limite" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "O máximo é 200 por hora." })).toBeVisible();
  await campo.fill("45");
  await page.getByRole("button", { name: "Salvar limite" }).click();
  await expect(page.getByText("Limite por hora salvo")).toBeVisible();
  expect(Number((await e2eSql("select value from settings where key = 'envio_teto_hora'"))[0].value)).toBe(45);

  await page.getByRole("radio", { name: "6 meses" }).click();
  await page.getByRole("button", { name: "Salvar prazo" }).click();
  await expect(page.getByText("Prazo das mídias salvo")).toBeVisible();
  expect((await e2eSql("select value from settings where key = 'retencao_midia_meses'"))[0].value).toBe(6);

  const quieto = page.locator("[data-testid^=quieto-]");
  await expect(quieto).toContainText(/Avisos pausados até (amanhã |\w{3} )?\d{2}:\d{2}/);
  await shot(page, "04-whatsapp-quieto-teto", { fullPage: true });
  await quieto.getByRole("button", { name: "Encerrar agora" }).click();
  const conf = page.getByRole("dialog", { name: "Retomar avisos agora?" });
  await conf.getByRole("button", { name: "Cancelar" }).click();
  expect((await e2eSql("select quiet_until from channels where instance_name = 'e2e-cfg-1'"))[0].quiet_until).not.toBeNull();
  await quieto.getByRole("button", { name: "Encerrar agora" }).click();
  await conf.getByRole("button", { name: "Retomar agora" }).click();
  await expect(quieto).toHaveCount(0);
  expect((await e2eSql("select quiet_until from channels where instance_name = 'e2e-cfg-1'"))[0].quiet_until).toBeNull();
});

test("Listas: lembrar retorno em N dias por serviço", async ({ page }) => {
  await login(page);
  await page.goto("/config/listas");
  await page.getByRole("tab", { name: "Serviços" }).click();
  const campo = page.getByLabel("Lembrar retorno de Corte em N dias");
  await campo.fill("90");
  await campo.blur();
  await expect(page.getByText("Lembrete de retorno em 90 dias")).toBeVisible();
  expect((await e2eSql("select cycle_days from lists where kind = 'service' and label = 'Corte'"))[0].cycle_days).toBe(90);
  await campo.fill("400");
  await campo.blur();
  await expect(page.getByText("O máximo é 365 dias.")).toBeVisible();
  await expect(campo).toHaveValue("90");
  await campo.fill("");
  await campo.blur();
  await expect(page.getByText("Sem lembrete de retorno")).toBeVisible();
  expect((await e2eSql("select cycle_days from lists where kind = 'service' and label = 'Corte'"))[0].cycle_days).toBeNull();
});

test("celular 390: sem rolagem lateral e alvos de 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await e2eSql("insert into channels (name, instance_name, status, quiet_until) values ('Salão', 'e2e-cfg-2', 'conectado', now() + interval '30 hours')");
  await login(page);
  for (const [path, nome] of [["/config/automacoes", "05-m-automacoes"], ["/config/mensagens", "06-m-mensagens"], ["/config/whatsapp", "07-m-whatsapp"]] as const) {
    await page.goto(path);
    expect(await semRolagemLateral(page), path).toBe(true);
    await shot(page, nome);
  }
  await page.goto("/config/listas");
  await page.getByRole("tab", { name: "Serviços" }).click();
  expect(await semRolagemLateral(page), "listas").toBe(true);
  const alvo = await page.getByLabel("Lembrar retorno de Corte em N dias").boundingBox();
  expect(alvo!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "08-m-listas-servicos");
  await page.goto("/config/automacoes");
  await page.getByRole("button", { name: "Começar de um modelo" }).click();
  expect(await semRolagemLateral(page), "modelos").toBe(true);
  await shot(page, "09-m-modelos");
  await page.goto("/config/whatsapp");
  const alvoQ = await page.getByRole("button", { name: "Encerrar agora" }).boundingBox();
  expect(alvoQ!.height).toBeGreaterThanOrEqual(44);
});
