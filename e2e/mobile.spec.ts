import { test, expect } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

test("celular: navegação inferior, fila e conversa sem rolagem lateral", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-1010", name: "Bruna Lima", text: "Oi, tudo bem? Queria agendar." });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" }).last();
  // Hoje, Conversas, Agenda e Caixa (o reset do e2e liga o caixa no CRM, 6C), + o botão Mais (Clientes e o grupo Gestão)
  await expect(nav.getByRole("link")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(nav.getByRole("button", { name: "Mais" })).toBeVisible();
  await nav.getByRole("link", { name: "Conversas" }).click();
  await expect(page).toHaveURL(/\/atendimento/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("option", { name: /Bruna Lima/ }).first().click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const sheet = page.getByRole("region", { name: /Conversa com Bruna Lima/ });
  // O painel da cliente abre por "ⓘ Cliente" em tela cheia, com as abas Agora e Cliente
  await sheet.getByRole("button", { name: "Ver dados da cliente" }).click();
  const cliente = page.getByRole("dialog", { name: "Bruna Lima" });
  await cliente.getByRole("tab", { name: "Cliente" }).click();
  await expect(cliente.getByRole("region", { name: "Dados da cliente" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("celular: sino abre o painel embaixo e tocar no alerta abre o lead", async ({ page }) => {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await login(page);
  await simulate(page, { phone: "71 99700-3030", name: "Carla Mendes", text: "Oi, tem horário amanhã?" });
  ageLead("+5571997003030", 31); // passa dos 30 min: o alerta escala e entra no sino da gestão (Lote 0)
  await page.goto("/");
  const bell = page.getByRole("button", { name: /Alertas, [1-9]/ }).first();
  expect((await bell.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await bell.tap();
  const panel = page.getByRole("dialog", { name: "Alertas" });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(500); // fim da animação
  const vp = page.viewportSize()!;
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.y + box.height)).toBe(vp.height); // colado embaixo
  expect(box.height).toBeLessThanOrEqual(vp.height * 0.8 + 1);
  const item = panel.getByRole("link", { name: /Carla Mendes/ }).first();
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "01-sino-celular");
  await item.tap();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/); // /atendimento?lead=ID vira a conversa em tela cheia no celular
  const [row] = await e2eSql("select read_at from alerts where message like '%Carla Mendes%' limit 1");
  expect(row.read_at).not.toBeNull(); // tocar no alerta marca como lido
  await expect(page.getByRole("region", { name: /Conversa com Carla Mendes/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Alertas" })).toHaveCount(0);
});

test("celular: aviso com Desfazer usa a largura da tela, não fica espremido em meia tela", async ({ page }) => {
  // O contêiner fixo em left: 50% encolhia o aviso para a metade da tela (195 px): "Débora Lima saiu da fila" quebrava em 5 linhas.
  await login(page);
  await simulate(page, { phone: "71 99700-4040", name: "Débora Lima Cavalcanti", text: "Oi, tem horário sábado?" });
  const [{ id }] = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = '+5571997004040' and d.archived_at is null");
  await page.goto(`/atendimento/${id}`);
  const lead = page.getByRole("region", { name: /Conversa com Débora Lima Cavalcanti/ });
  await lead.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Marcar como spam/ }).click();
  const aviso = page.getByRole("status").filter({ hasText: "Débora Lima Cavalcanti agora é Spam e saiu da lista" });
  await expect(aviso).toBeVisible();
  await page.waitForTimeout(400); // fim da animação de entrada
  const vp = page.viewportSize()!;
  const box = (await aviso.boundingBox())!;
  expect(box.width).toBeGreaterThan(vp.width / 2 + 40);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.height).toBeLessThanOrEqual(64); // no máximo duas linhas de texto (o botão tem 44 px)
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(lead).toBeVisible();
});

test("celular: banner de conexão cabe em 390 px", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status) values ('Salão', 'e2e-banner-m', 'erro')");
  try {
    await login(page);
    await expect(page.getByTestId("banner-conexao")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await e2eSql("delete from channels where instance_name = 'e2e-banner-m'"); }
});

test("celular: relatórios cabem em 390 px, alvos de 44 px e mapa de calor rola só dentro do bloco", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-9090", name: "Teresa Lima", text: "Oi, queria um horário." }); // garante ao menos uma mensagem no mapa de calor
  await page.goto("/relatorios?periodo=mes");
  await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const name of ["Visão geral", "Análise"]) expect((await page.getByRole("tab", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: "Exportar" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.addStyleTag({ content: 'nav[aria-label="Principal"], nextjs-portal { display: none !important }' }); // só para o print de página inteira: barra fixa e selo do dev não repetem no meio
  await shot(page, "03-visao-geral-celular", { fullPage: true });
  for (const c of await page.locator("dl > div > dd > p.font-display").evaluateAll((els) => els.map((el) => ({ sw: el.scrollWidth, cw: el.clientWidth })))) expect(c.sw).toBeLessThanOrEqual(c.cw);
  await page.getByRole("tab", { name: "Análise" }).click();
  await expect(page).toHaveURL(/aba=analise/);
  const region = page.getByRole("region", { name: /Mapa de calor/ });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const { sw, cw } = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(sw).toBeGreaterThan(cw); // rola dentro do bloco
  expect(cw).toBeLessThanOrEqual(390);
});

test.describe("celular: topo dos relatórios em 2x", () => {
  test.use({ deviceScaleFactor: 2 });
  test("resumo e números legíveis, sem estourar a célula", async ({ page }) => {
    await login(page);
    await page.goto("/relatorios?periodo=mes");
    await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
    await page.addStyleTag({ content: 'nav[aria-label="Principal"], nextjs-portal { display: none !important }' }); // só para o print de página inteira: barra fixa e selo do dev não repetem no meio
    await shot(page, "04-topo-celular-390x1200", { fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1200 } });
  });
});

test("celular: com agendados para conferir, a primeira conversa da Fila aparece sem rolar (Conferir vira uma linha)", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99702-0001", name: "Fila Primeira", text: "Oi, tem horário?" });
  const [lead] = await e2eSql("select id from stages where key = 'agendado'");
  for (let i = 0; i < 5; i++) {
    await simulate(page, { phone: `71 99702-01${String(i).padStart(2, "0")}`, name: `Conferir ${i}`, text: "ok" });
    await e2eSql(`update deals set stage_id = $1, scheduled_at = now() - interval '3 hours', awaiting_reply_since = null, attendance = null
      where contact_id = (select id from contacts where phone_e164 = $2)`, [lead.id, `+55719970201${String(i).padStart(2, "0")}`]);
  }
  await page.goto("/atendimento");
  const conferir = page.getByRole("region", { name: "Ela veio?" });
  await expect(conferir.getByRole("button", { name: /Ela veio\? \(\d+\)/ })).toHaveAttribute("aria-expanded", "true"); // começa aberta
  await expect(conferir.getByTestId("conferir-item").first()).toBeVisible();
  const first = page.getByRole("listbox", { name: "Fila" }).getByRole("option").first(); // o filtro de etiqueta (select) também tem options
  await expect(first).toBeVisible();
  const box = (await first.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Principal" }).last().boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y); // inteira acima da barra de baixo, sem rolar
});

test("celular: alvos de 44 px fora do caixa (QA r58, M-9): Dia/Semana, nomes dos serviços, ‹ Fila e ↑↓ das etapas", async ({ page, isMobile }) => {
  test.skip(!isMobile, "celular");
  await login(page);
  const alto = async (loc: import("@playwright/test").Locator, nome: string) => {
    const b = (await loc.boundingBox())!;
    expect(b.height, `${nome}: altura`).toBeGreaterThanOrEqual(44);
    expect(b.width, `${nome}: largura`).toBeGreaterThanOrEqual(44);
  };
  await page.goto("/agenda");
  const verPor = page.getByRole("navigation", { name: "Ver por" });
  await alto(verPor.getByRole("link", { name: "Dia" }), "Dia");
  await alto(verPor.getByRole("link", { name: "Semana" }), "Semana");
  await page.goto("/servicos");
  await alto(page.getByRole("button", { name: /^Corte/ }).first(), "nome do serviço");
  await page.goto("/atendimento/programadas");
  await alto(page.getByRole("link", { name: "‹ Fila" }), "‹ Fila");
  await page.goto("/config/etapas?parte=etapas");
  await alto(page.getByRole("button", { name: /^Descer / }).first(), "↓ da etapa");
  await alto(page.getByRole("button", { name: /^Subir / }).nth(1), "↑ da etapa");
});
