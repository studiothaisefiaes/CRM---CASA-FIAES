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
  await expect(page.getByTestId("modelos").getByRole("button")).toHaveCount(6); // Plano 5: sem os dois modelos do lembrete da véspera
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
  await expect(aviso).toContainText(/Agora isto atingiria \d+ clientes?\./);
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
  const ed = page.getByRole("dialog", { name: "Editar automação" });
  // Toque antes da hidratação (dev server compilando a rota) não abre o editor: tenta de novo até abrir.
  await expect(async () => {
    if (!(await ed.isVisible())) await card.getByRole("button", { name: "Editar" }).click();
    await expect(ed).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await ed.getByRole("button", { name: "Salvar" }).click(); // sem envio: salva direto
  await expect(page.getByText("Automação salva")).toBeVisible();
  await card.getByRole("button", { name: "Editar" }).click();
  await ed.locator("select").filter({ has: page.locator('option[value="enviar_mensagem"]') }).selectOption("enviar_mensagem"); // o select da ação (há também "Horário da Casa" e "Etiqueta da cliente")
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
  await page.goto("/config/mensagens?parte=fora-do-horario");
  await expect(page.getByRole("heading", { name: "Resposta fora do horário", level: 1 })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "Isto manda mensagem para cliente sem ninguém apertar enviar." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Boas-vindas" })).toHaveCount(0); // só a mensagem escolhida, não as quatro
  await expect(page.getByTestId("nota-expediente")).toContainText("24 horas");
  const texto = page.getByLabel("Texto da resposta");
  await texto.fill("Oi, {nome}! Estamos fechados agora e respondemos assim que abrir.");
  await expect(page.getByTestId("previa-resposta")).toHaveText("Oi, Maria! Estamos fechados agora e respondemos assim que abrir.");
  await page.getByRole("button", { name: "Salvar texto", exact: true }).click(); // as mensagens do Lote 4 têm "Salvar texto de …"
  await expect(page.getByText("Texto salvo. A resposta continua desligada")).toBeVisible();
  expect((await e2eSql("select value from settings where key = 'auto_resposta'"))[0].value).toMatchObject({ enabled: false });
  await shot(page, "03-resposta-fora-do-horario");

  const sw = page.getByRole("switch", { name: "Ligar a resposta fora do horário" });
  await sw.click();
  const aviso = page.getByRole("dialog", { name: "Ligar o envio automático?" });
  await expect(aviso).toContainText("Isto vai enviar mensagens reais para clientes.");
  await expect(aviso).toContainText("Responde automaticamente quando a Casa está fechada, uma vez a cada 12 h por cliente.");
  await expect(aviso).not.toContainText("só no horário de atendimento");
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
  // Área de cuidado: dá para ver, mas mexer só depois de confirmar
  await expect(page.locator("[data-travado]")).toHaveCount(1);
  await page.getByRole("button", { name: "Quero mexer aqui" }).click();
  await page.getByRole("button", { name: "Sim, liberar" }).click();
  await expect(page.locator("[data-travado]")).toHaveCount(0);
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

  // Padrão: não apaga nada até a gestão escolher um prazo (apagar mídia de clientes é irreversível)
  await expect(page.getByRole("radio", { name: "Não apagar" })).toBeChecked();
  await expect(page.getByText("Nenhuma mídia é apagada até você escolher um prazo.")).toBeVisible();
  await page.getByRole("radio", { name: "6 meses" }).click();
  await page.getByRole("button", { name: "Salvar prazo" }).click();
  await expect(page.getByText("Prazo das mídias salvo")).toBeVisible();
  expect((await e2eSql("select value from settings where key = 'retencao_midia_meses'"))[0].value).toBe(6);

  const quieto = page.locator("[data-testid^=quieto-]");
  await expect(quieto).toContainText(/Avisos pausados até (amanhã |\w{3} )?\d{2}:\d{2}/);
  await shot(page, "04-whatsapp-quieto-teto", { fullPage: true });
  await quieto.getByRole("button", { name: "Retomar avisos agora" }).click();
  const conf = page.getByRole("dialog", { name: "Retomar avisos agora?" });
  await conf.getByRole("button", { name: "Cancelar" }).click();
  expect((await e2eSql("select quiet_until from channels where instance_name = 'e2e-cfg-1'"))[0].quiet_until).not.toBeNull();
  await quieto.getByRole("button", { name: "Retomar avisos agora" }).click();
  await conf.getByRole("button", { name: "Retomar agora" }).click();
  await expect(quieto).toHaveCount(0);
  expect((await e2eSql("select quiet_until from channels where instance_name = 'e2e-cfg-1'"))[0].quiet_until).toBeNull();
});

// Lembrar retorno em N dias por serviço: foi para a aba Serviços (e2e/servicos.spec.ts).

test("celular 390: sem rolagem lateral e alvos de 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await e2eSql("insert into channels (name, instance_name, status, quiet_until) values ('Salão', 'e2e-cfg-2', 'conectado', now() + interval '30 hours')");
  await login(page);
  for (const [path, nome] of [["/config", "05-m-indice"], ["/config/automacoes?parte=regras", "05-m-automacoes"], ["/config/mensagens?parte=fora-do-horario", "06-m-mensagens"], ["/config/whatsapp", "07-m-whatsapp"]] as const) {
    await page.goto(path);
    expect(await semRolagemLateral(page), path).toBe(true);
    await shot(page, nome);
  }
  await page.goto("/config/listas?aba=keyword");
  expect(await semRolagemLateral(page), "listas").toBe(true);
  await shot(page, "08-m-listas-palavras");
  await page.goto("/config/automacoes?parte=regras");
  await page.getByRole("button", { name: "Começar de um modelo" }).click();
  expect(await semRolagemLateral(page), "modelos").toBe(true);
  await shot(page, "09-m-modelos");
  await page.goto("/config/whatsapp");
  const alvoQ = await page.locator("[data-testid^=quieto-]").getByRole("button", { name: "Retomar avisos agora" }).boundingBox();
  expect(alvoQ!.height).toBeGreaterThanOrEqual(44);
});

test("lembrete do horário: texto sugerido arejado e as quebras de linha ficam depois de salvar (17/10)", async ({ page }) => {
  await e2eSql("insert into settings (key, value) values ('lembrete_d1', $1) on conflict (key) do update set value = excluded.value",
    [JSON.stringify({ enabled: false, comLink: false, texto: "Oi, {primeiro_nome}! Passando para lembrar do seu horário amanhã: {data} às {hora}, {servicos}.", textoRemarcado: "Oi, {primeiro_nome}! Remarcado para {data} às {hora}, {servicos}." })]);
  try {
    await login(page);
    await page.goto("/config/automacoes?parte=lembrete");
    const texto = page.getByLabel("Texto do lembrete");
    await expect(texto).toHaveValue(/Passando para lembrar do seu horário amanhã: \{data\}/);
    await expect(async () => {
      await page.getByRole("button", { name: "Usar o texto da Casa no lembrete" }).click();
      await expect(texto).toHaveValue(/💛\n\nPodemos confirmar sua presença/, { timeout: 2_000 });
    }).toPass();
    await page.getByRole("button", { name: "Usar o texto sugerido da remarcação" }).click();
    await texto.press("End");
    await texto.press("Enter");
    await texto.pressSequentially("Beijos!");
    await page.getByRole("button", { name: "Salvar textos" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();
    const [{ value }] = await e2eSql("select value from settings where key = 'lembrete_d1'") as { value: { texto: string; textoRemarcado: string } }[];
    expect(value.texto).toContain("📅 *{data}* às *{hora}*\n{servicos}\n");
    expect(value.texto.endsWith("responder por aqui.\nBeijos!")).toBe(true);
    expect(value.textoRemarcado).toContain("remarcado para:\n\n📅");
    await page.reload();
    await expect(page.getByLabel("Texto do lembrete")).toHaveValue(/responder por aqui\.\nBeijos!$/);
  } finally {
    await e2eSql("delete from settings where key = 'lembrete_d1'");
  }
});
