import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

/** Seis leads em seis seções da Fila (a Casa fica aberta 24 h no banco de e2e, então a espera conta o tempo todo). */
async function cenario(page: Page) {
  // Isola o cenário do que os outros specs deixaram no banco de e2e: avisos antigos resolvidos e leads de fora arquivados.
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like '+5571997101%')");
  const phone = (n: number) => `+55719971${String(n).padStart(5, "0")}`;
  const entra = (n: number, name: string, text: string, fromMe = false) => simulate(page, { phone: `71 99710-${String(n).slice(-4)}`, name, text, fromMe });
  await entra(1001, "Valéria Nogueira", "Oi, tem horário amanhã?");
  await entra(1002, "Rosana Tavares", "Boa tarde, quanto custa a hidratação?");
  await entra(1003, "Tatiane Moura", "Oi! Vocês fazem coloração?");
  await entra(1004, "Elaine Pacheco", "Quero marcar um corte.");
  await entra(1004, "", "Oi Elaine, temos quinta às 15h. Pode ser?", true);
  await entra(1005, "Márcia Lopes", "Vou pensar e te falo.");
  await entra(1005, "", "Combinado, Márcia! Fico no aguardo.", true);
  await entra(1006, "Priscila Andrade", "Qual o valor da escova?");
  await entra(1006, "", "A escova começa em R$ 80. Quer agendar?", true);
  ageLead(phone(1001), 11); // passa do prazo da etapa e o motor abre o alerta de espera
  await e2eSql("update deals set awaiting_reply_since = now() - interval '75 seconds' where contact_id = (select id from contacts where phone_e164 = $1)", [phone(1002)]); // 62% do prazo
  await e2eSql("update contacts set is_client = true where phone_e164 = $1", [phone(1004)]);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where contact_id in (select id from contacts where phone_e164 = any($1))", [[phone(1001), phone(1002), phone(1005)]]);
  await e2eSql(`insert into tasks (deal_id, contact_id, kind, title, due_at)
    select d.id, d.contact_id, 'proxima_acao', 'Ligar com os valores', now() - interval '40 minutes' from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1`, [phone(1005)]);
  await e2eSql(`update deals set stage_id = (select id from stages where key = 'atendimento'), stage_entered_at = now() - interval '3 days'
    where contact_id = (select id from contacts where phone_e164 = $1)`, [phone(1006)]);
}

test("fila (desktop): seções por urgência, conversa no painel do meio e teclado", async ({ page, isMobile }) => {
  test.skip(isMobile, "os 3 painéis são do desktop");
  await login(page);
  await cenario(page);
  await page.goto("/atendimento");
  const fila = page.getByRole("listbox", { name: "Fila" });
  await expect(fila).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atendimento" })).toBeVisible();

  // Ordem por urgência: atrasados, perto do prazo, aguardando, ações de hoje, parados, aguardando a cliente.
  const ids = await fila.locator("[role=group]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby")));
  expect(ids).toEqual(["fila-atrasados", "fila-perto", "fila-aguardando", "fila-acoes-hoje", "fila-parados", "fila-aguardando-cliente"]);
  const carla = fila.getByRole("group", { name: "Atrasados" }).getByRole("option", { name: /Valéria Nogueira/ });
  await expect(carla).toContainText(/atrasado( \d+ min)?/);
  await expect(fila.getByRole("group", { name: "Perto do prazo" }).getByRole("option", { name: /Rosana Tavares/ })).toContainText(/perto do prazo/);
  await expect(fila.getByRole("group", { name: "Aguardando resposta" }).getByRole("option", { name: /Tatiane Moura/ })).toBeVisible();
  await expect(fila.getByRole("group", { name: "Próximas ações de hoje" }).getByRole("option", { name: /Márcia Lopes/ })).toContainText("Ligar com os valores");
  await expect(fila.getByRole("group", { name: "Parados" }).getByRole("option", { name: /Priscila Andrade/ })).toBeVisible();
  await shot(page, "02-desktop-sem-lead");
  // "Aguardando a cliente" começa recolhida
  const recolhida = fila.getByRole("group", { name: "Aguardando a cliente" });
  await expect(recolhida.getByRole("option")).toHaveCount(0);
  await recolhida.getByRole("button", { name: "Mostrar" }).click();
  await expect(recolhida.getByRole("option", { name: /Elaine Pacheco/ })).toContainText("Cliente");
  // resumo: cada número filtra
  const resumo = page.getByLabel("Resumo da fila");
  await expect(resumo).toContainText(/aguardando/);
  await expect(resumo.getByRole("link", { name: /atrasado/ })).toContainText(/^1 atrasado$/);

  // Sem lead aberto: o painel do meio pede para escolher
  await expect(page.getByText("Escolha uma conversa")).toBeVisible();

  // Clicar abre a conversa no painel do meio, sem sair da lista
  await carla.click();
  await expect(page).toHaveURL(/\/atendimento\?lead=[0-9a-f-]{36}/);
  const lead = page.getByRole("region", { name: /Lead Valéria Nogueira/ });
  await expect(lead).toBeVisible();
  await expect(fila).toBeVisible();
  await expect(carla).toHaveAttribute("aria-selected", "true");
  const box = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!;
  const listaBox = await box(page.getByRole("region", { name: "Fila de atendimento" }));
  const conversaBox = await box(page.getByRole("region", { name: "Conversa" }));
  const clienteBox = await box(page.getByRole("region", { name: "Dados do cliente" }));
  expect(Math.round(listaBox.width)).toBe(340);
  expect(Math.round(clienteBox.width)).toBe(300);
  expect(conversaBox.x).toBeGreaterThanOrEqual(listaBox.x + listaBox.width - 1);
  expect(clienteBox.x).toBeGreaterThanOrEqual(conversaBox.x + conversaBox.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await shot(page, "01-desktop-lead-1440");

  // Teclado: setas movem o foco entre os itens e Enter abre
  await fila.getByRole("option").first().focus();
  await page.keyboard.press("ArrowDown");
  const segundo = fila.getByRole("option").nth(1);
  await expect(segundo).toBeFocused();
  const alvo = await segundo.getAttribute("data-deal-id");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`lead=${alvo}`));
  await page.keyboard.press("End");
  await expect(fila.getByRole("option").last()).toBeFocused();
});

test("fila (desktop): filtro vem do resumo, volta pela barra lateral e /funil?lead= segue valendo", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await cenario(page);
  await page.goto("/atendimento");
  await page.getByLabel("Resumo da fila").getByRole("link", { name: /atrasado/ }).click();
  await expect(page).toHaveURL(/filtro=atrasados/);
  const fila = page.getByRole("listbox", { name: "Fila" });
  await expect(fila.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Mostrando: leads atrasados" })).toBeVisible();
  // O estado fica guardado: a barra lateral leva de volta ao mesmo filtro
  await page.goto("/relatorios");
  await page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Atendimento" }).click();
  await expect(page).toHaveURL(/filtro=atrasados/);
  // Mostrar todos limpa de forma explícita
  await page.getByRole("link", { name: "Mostrar todos" }).click();
  await expect(page).toHaveURL(/view=todos/);
  await expect(fila.getByRole("option").nth(4)).toBeVisible(); // 5 visíveis; a sexta seção (aguardando a cliente) segue recolhida
  // Visões prontas pelo menu
  await page.getByRole("button", { name: "Visão da fila" }).click();
  await page.getByRole("menuitem", { name: /Sem dono/ }).click();
  await expect(page).toHaveURL(/view=sem-dono/);
  await expect(page.getByRole("button", { name: "Visão da fila" })).toContainText("Sem dono");
  // O Quadro fica dentro de Atendimento
  await page.getByRole("radio", { name: "Quadro" }).click();
  await expect(page).toHaveURL(/\/funil$/);
  await expect(page.getByRole("heading", { name: "Quadro" })).toBeVisible();
  const [row] = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = '+5571997101001'");
  await page.goto(`/funil?lead=${row.id}`);
  await expect(page.getByRole("dialog", { name: /Lead Valéria Nogueira/ })).toBeVisible(); // links antigos seguem abrindo o lead no Quadro
});

test("fila (celular): abrir conversa e voltar preserva filtro e rolagem", async ({ page, isMobile }) => {
  test.skip(!isMobile, "celular");
  await login(page);
  for (let i = 0; i < 12; i++) await simulate(page, { phone: `7198800${String(i).padStart(4, "0")}`, name: `Cliente ${i}`, text: "oi" });
  await page.goto("/atendimento?view=todos");
  await page.getByRole("listbox", { name: "Fila" }).evaluate((el) => (el.scrollTop = 400));
  await page.getByRole("option").nth(8).click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/);
  await page.getByRole("link", { name: "Voltar para a fila" }).click();
  await expect(page).toHaveURL(/view=todos/);
  expect(await page.getByRole("listbox", { name: "Fila" }).evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
});

test.describe("celular: lista em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });
  test("sem rolagem lateral, alvos de 44 px, campos de 16 px e /atendimento?lead= leva à conversa", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    await cenario(page);
    await page.goto("/atendimento");
    const fila = page.getByRole("listbox", { name: "Fila" });
    await expect(fila.getByRole("option", { name: /Valéria Nogueira/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const o of await fila.getByRole("option").all()) expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const c of [page.getByRole("searchbox"), page.getByRole("button", { name: "Visão da fila" })]) {
      expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await c.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }
    for (const l of await page.getByLabel("Resumo da fila").getByRole("link").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "03-celular-lista-390");
    const id = await fila.getByRole("option", { name: /Valéria Nogueira/ }).getAttribute("data-deal-id");
    await page.goto(`/atendimento?lead=${id}`);
    await expect(page).toHaveURL(new RegExp(`/atendimento/${id}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByRole("region", { name: /Lead Valéria Nogueira/ })).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "04-celular-conversa-390");
  });
});
