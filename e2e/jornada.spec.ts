import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot, usaQuadroIsolado } from "./helpers";

const PREFIXO = "+5571997350";
const phone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;
const entra = (page: Page, n: number, name: string, text = "Oi, tudo bem?", fromMe = false) => simulate(page, { phone: `71 99735-0${String(n).padStart(3, "0")}`, name, text, fromMe });
const noEstagio = (n: number, key: string, extra = "") => e2eSql(`update deals set stage_id = (select id from stages where key = $2) ${extra} where contact_id = (select id from contacts where phone_e164 = $1)`, [phone(n), key]);

const isola = usaQuadroIsolado();

/** Um pouco de cada estação, com um lead atrasado e um perto do prazo. */
async function cenario(page: Page) {
  await isola();
  await entra(page, 1, "Valéria Nogueira", "Oi, tem horário amanhã?");
  await entra(page, 2, "Rosana Tavares", "Quanto custa a hidratação?");
  await entra(page, 3, "Tatiane Moura", "Vocês fazem coloração?");
  await entra(page, 4, "Elaine Pacheco", "Quero marcar um corte.");
  await entra(page, 4, "", "Oi Elaine, temos quinta às 15h.", true);
  await entra(page, 5, "Márcia Lopes", "Vou pensar e te falo.");
  await entra(page, 5, "", "Combinado, Márcia!", true);
  await entra(page, 6, "Priscila Andrade", "Qual o valor da escova?");
  await entra(page, 7, "Bianca Teles", "Posso remarcar?");
  await entra(page, 8, "Camila Duarte", "Voltei a pensar no corte.");
  await entra(page, 9, "Daniela Rocha", "Obrigada pelo atendimento!");
  ageLead(phone(1), 11);
  await e2eSql("update deals set awaiting_reply_since = now() - interval '75 seconds' where contact_id = (select id from contacts where phone_e164 = $1)", [phone(2)]);
  await noEstagio(6, "agendado", ", awaiting_reply_since = null, scheduled_at = now() + interval '1 day'");
  // Aguardando cliente e Fechado saíram do funil (16/10): esperar a cliente é Em conversa sem espera; a venda termina em Atendida
  await noEstagio(7, "atendimento", ", awaiting_reply_since = null");
  await noEstagio(8, "atendimento", ", awaiting_reply_since = null");
  await noEstagio(9, "atendida", ", awaiting_reply_since = null, closed_at = now() - interval '3 days', value_cents = 25000");
}
const contagem = async (page: Page, nome: string) => Number((await page.locator(`[data-station="${nome}"]`).getByRole("link").first().innerText()).match(/(\d+)/)![1]);

test.describe("Jornada (desktop)", () => {
  test.beforeEach(({ isMobile }) => { test.skip(isMobile, "desktop"); });

  test("a gestão abre por Relatórios, vê as estações com as contagens do Quadro e clica numa para abrir a Fila filtrada", async ({ page }) => {
    await login(page);
    await cenario(page);
    await page.goto("/atendimento");
    // Jornada saiu das abas de Conversas (17/10): fica em Relatórios, como aba dentro da tela
    const abas = page.getByRole("navigation", { name: "Formas de ver as conversas" });
    await expect(abas.getByRole("link", { name: "Jornada" })).toHaveCount(0);
    const naFila = await abas.boundingBox();
    await page.goto("/relatorios");
    const menu = page.getByRole("navigation", { name: "Principal" }).first();
    await page.getByRole("link", { name: "Abrir Jornada" }).click();
    await expect(page).toHaveURL(/\/jornada$/);
    await expect(page.getByRole("heading", { name: "Jornada", level: 1 })).toBeVisible();
    // Menu: Relatórios aceso; dentro da tela, o link de volta a Relatórios (Jornada não é aba).
    await expect(menu.getByRole("link", { name: "Relatórios", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main").getByRole("link", { name: "Relatórios", exact: true })).toHaveAttribute("href", "/relatorios"); // "‹ Relatórios" do cabeçalho

    // As estações, na ordem das etapas, e o atraso do lead que passou do prazo
    const estacoes = await page.locator("[data-station]").evaluateAll((els) => els.map((e) => e.getAttribute("data-station")));
    expect(estacoes).toEqual(["lead", "atendimento", "orcamento", "agendado", "na_casa", "atendida", "retorno", "perdido"]);
    const lead = page.locator('[data-station="lead"]');
    await expect(lead.getByRole("link", { name: /^Novo contato: 3 conversas, 1 atrasado/ })).toBeVisible();
    // O nome acessível começa pelo texto que está na tela ("Valéria N.") e traz o nome inteiro depois; no fim, a dona (o selo com as iniciais é só visual)
    await expect(lead.getByRole("link", { name: /^Valéria N\. \(Valéria Nogueira\), atrasado · \d+ min, dona Ana$/ })).toBeVisible();
    await expect(lead.getByText("Valéria N.", { exact: true })).toBeVisible();
    await expect(page.locator('[data-station="atendimento"]').getByRole("link", { name: /^Em conversa: 4 conversas/ })).toBeVisible();
    await expect(page.locator('[data-station="perdido"]')).toContainText("Ninguém aqui ainda");

    // Cada estação diz o que importa nela: o horário marcado, ou com quem está a bola
    await expect(page.locator('[data-station="atendida"]').getByRole("link", { name: /^Daniela R\. \(Daniela Rocha\), com a cliente, dona Ana$/ })).toBeVisible();
    const agendado = page.locator('[data-station="agendado"]');
    await expect(agendado.getByRole("link", { name: /^Priscila A\. \(Priscila Andrade\), agendado para (hoje|amanhã|[a-zç]{3}) \d{1,2}h(\d{2})?, dona Ana$/ })).toBeVisible();
    await expect(page.locator('[data-station="atendimento"]').getByText("com a cliente")).toHaveCount(4);
    await expect(page.getByText("abra uma etapa para ver a Fila")).toBeVisible();

    // Os números batem com o Quadro
    const jornada = { lead: await contagem(page, "lead"), atendimento: await contagem(page, "atendimento"), agendado: await contagem(page, "agendado"), atendida: await contagem(page, "atendida") };
    await page.goto("/funil");
    await expect(page).toHaveURL(/\/funil$/);
    expect([(await abas.boundingBox())!.x, (await abas.boundingBox())!.y]).toEqual([naFila!.x, naFila!.y]);
    const noQuadro = async (re: RegExp) => Number((await page.getByRole("region", { name: re }).getAttribute("aria-label"))!.match(/(\d+) conversas?$/)![1]);
    expect(jornada).toEqual({ lead: await noQuadro(/^Novo contato,/), atendimento: await noQuadro(/^Em conversa,/), agendado: await noQuadro(/^Agendado,/), atendida: await noQuadro(/^Atendida,/) });
    await page.goto("/jornada");

    // Clicar na estação abre a Fila só com aquela etapa
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Novo contato: 3 conversas/ }).click();
    await expect(page).toHaveURL(/\/atendimento\?etapa=lead$/);
    await expect(page.getByRole("link", { name: "Tirar o filtro Etapa: Novo contato" })).toBeVisible();
    const fila = page.getByRole("listbox", { name: "Fila" });
    await expect(fila.getByRole("option")).toHaveCount(3);
    await expect(fila.getByRole("option", { name: /Elaine Pacheco/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Mostrar todos" }).click();
    await expect(page).toHaveURL(/view=todos/);

    // Uma pessoa leva ao lead
    await page.goto("/jornada");
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Tatiane M\. \(Tatiane Moura\)/ }).click();
    await expect(page).toHaveURL(/\/atendimento\?lead=[0-9a-f-]{36}/);
  });

  test("mais de 12 pessoas numa estação viram os 12 mais urgentes e '+N'", async ({ page }) => {
    await login(page);
    await cenario(page);
    await e2eSql(`insert into contacts (name, phone_e164) select 'Extra ' || g, '${PREFIXO}1' || lpad(g::text, 2, '0') from generate_series(1, 11) g on conflict (phone_e164) do nothing`);
    await e2eSql(`insert into deals (contact_id, stage_id, awaiting_reply_since) select c.id, (select id from stages where key = 'lead'), now() - interval '20 seconds'
      from contacts c where c.phone_e164 like '${PREFIXO}1%'`);
    await page.goto("/jornada");
    const lead = page.locator('[data-station="lead"]');
    await expect(lead.getByRole("link", { name: /^Novo contato: 14 conversas/ })).toBeVisible();
    await expect(lead.getByRole("list", { name: "Pessoas em Novo contato" }).getByRole("listitem")).toHaveCount(13); // 12 pessoas + o "+2"
    await expect(lead.getByRole("button", { name: "Mais 2 em Novo contato" })).toHaveText("+2");
    // O "+2" abre a estação ali mesmo: a Jornada continua na tela, com as 14 pessoas; "Mostrar menos" volta às 12.
    await lead.getByRole("button", { name: "Mais 2 em Novo contato" }).click();
    await expect(lead.getByRole("list", { name: "Pessoas em Novo contato" }).getByRole("listitem")).toHaveCount(14);
    await expect(page).toHaveURL(/\/jornada$/);
    await lead.getByRole("button", { name: "Mostrar menos" }).click();
    await expect(lead.getByRole("list", { name: "Pessoas em Novo contato" }).getByRole("listitem")).toHaveCount(13);
  });

  test("a atendente não acessa a Jornada: sem aba, sem menu e a rota volta para o Hoje com aviso", async ({ page }) => {
    await login(page, "ana@e2e.local");
    await page.goto("/atendimento");
    await expect(page.getByRole("navigation", { name: "Formas de ver as conversas" }).getByRole("link", { name: "Jornada" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Jornada" })).toHaveCount(0);
    await page.goto("/jornada");
    await expect(page).toHaveURL(/\/\?aviso=sem-permissao/);
    await expect(page.getByRole("heading", { name: "Jornada" })).toHaveCount(0);
  });

  test("print da Jornada no desktop", async ({ page }) => {
    await login(page);
    await cenario(page);
    await page.goto("/jornada");
    await expect(page.locator('[data-station="lead"]')).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "jornada-desktop");
  });
});

test.describe("Jornada (celular 390)", () => {
  test.use({ deviceScaleFactor: 2 });
  test("as estações empilham, sem rolagem lateral, com alvos de 44 px, e o Mais fica aceso (Jornada é de Relatórios)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    await cenario(page);
    await page.goto("/jornada");
    await expect(page.locator('[data-station="lead"]')).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // Empilhadas: cada estação abaixo da anterior, todas na largura da tela
    const caixas = await page.locator("[data-station]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; }));
    for (let i = 1; i < caixas.length; i++) expect(caixas[i].top).toBeGreaterThan(caixas[i - 1].top);
    for (const c of caixas) expect(c.right).toBeLessThanOrEqual(390);
    for (const l of await page.locator("[data-station] > a").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "jornada-celular-390-topo", { clip: { x: 0, y: 0, width: 390, height: 844 } });
    await page.locator('[data-station="lead"]').scrollIntoViewIfNeeded();
    // Jornada fica em Relatórios (17/10), que no celular mora no "Mais": ele fica aceso
    await expect(page.getByRole("navigation", { name: "Principal" }).last().getByRole("button", { name: "Mais" })).toHaveClass(/text-ink/);
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Novo contato: 3 conversas/ }).click();
    await expect(page).toHaveURL(/etapa=lead$/);
  });
});
