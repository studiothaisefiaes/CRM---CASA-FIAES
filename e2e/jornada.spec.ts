import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

const PREFIXO = "+5571997350";
const phone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;
const entra = (page: Page, n: number, name: string, text = "Oi, tudo bem?", fromMe = false) => simulate(page, { phone: `71 99735-0${String(n).padStart(3, "0")}`, name, text, fromMe });
const noEstagio = (n: number, key: string, extra = "") => e2eSql(`update deals set stage_id = (select id from stages where key = $2) ${extra} where contact_id = (select id from contacts where phone_e164 = $1)`, [phone(n), key]);

async function isola() {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null"); // todo teste começa de um quadro limpo (inclusive dos leads dos testes anteriores deste arquivo)
}

/**
 * Estes testes precisam de um quadro só deles, mas o banco de e2e é compartilhado com os outros arquivos (os relatórios somam as vendas do dia, por exemplo):
 * antes de tudo os leads que já existiam saem de cena (arquivados) e, no fim, os dos testes saem e os de antes voltam.
 */
let existentes: string[] = [];
test.beforeAll(async () => {
  existentes = (await e2eSql("select id from deals where archived_at is null")).map((r) => r.id as string);
  await e2eSql("update deals set archived_at = now() where id = any($1)", [existentes]);
});
test.afterAll(async () => {
  await e2eSql("update deals set archived_at = now() where archived_at is null");
  await e2eSql("update deals set archived_at = null where id = any($1)", [existentes]);
});

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
  await noEstagio(7, "followup_1", ", awaiting_reply_since = null");
  await noEstagio(8, "followup_2", ", awaiting_reply_since = null");
  await noEstagio(9, "fechado", ", awaiting_reply_since = null, closed_at = now(), value_cents = 25000");
}
const contagem = async (page: Page, nome: string) => Number((await page.locator(`[data-station="${nome}"]`).getByRole("link").first().innerText()).match(/(\d+)/)![1]);

test.describe("Jornada (desktop)", () => {
  test.beforeEach(({ isMobile }) => { test.skip(isMobile, "desktop"); });

  test("a gestão abre pelo menu, vê as estações com as contagens do Quadro e clica numa para abrir a Fila filtrada", async ({ page }) => {
    await login(page);
    await cenario(page);
    await page.goto("/atendimento");
    await expect(page.getByRole("radio", { name: "Jornada" })).toBeVisible();
    await page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Jornada" }).click();
    await expect(page).toHaveURL(/\/jornada$/);
    await expect(page.getByRole("heading", { name: "Jornada", level: 1 })).toBeVisible();

    // As estações, na ordem das etapas, e o atraso do lead que passou do prazo
    const estacoes = await page.locator("[data-station]").evaluateAll((els) => els.map((e) => e.getAttribute("data-station")));
    expect(estacoes).toEqual(["lead", "atendimento", "agendado", "followup", "fechado", "perdido"]);
    const lead = page.locator('[data-station="lead"]');
    await expect(lead.getByRole("link", { name: /^Lead: 3 leads, 1 atrasado/ })).toBeVisible();
    await expect(lead.getByRole("link", { name: /Valéria Nogueira, atrasado/ })).toBeVisible();
    await expect(page.locator('[data-station="followup"]').getByRole("link", { name: /^Follow-up: 2 leads/ })).toBeVisible();
    await expect(page.locator('[data-station="perdido"]')).toContainText("Ninguém aqui ainda");

    // Os números batem com o Quadro
    const jornada = { lead: await contagem(page, "lead"), atendimento: await contagem(page, "atendimento"), agendado: await contagem(page, "agendado"), followup: await contagem(page, "followup"), fechado: await contagem(page, "fechado") };
    await page.getByRole("radio", { name: "Quadro" }).click();
    await expect(page).toHaveURL(/\/funil$/);
    const noQuadro = async (re: RegExp) => Number((await page.getByRole("region", { name: re }).getAttribute("aria-label"))!.match(/(\d+) leads?$/)![1]);
    expect(jornada).toEqual({ lead: await noQuadro(/^Lead,/), atendimento: await noQuadro(/^Atendimento,/), agendado: await noQuadro(/^Agendado,/), followup: await noQuadro(/^Follow-up,/), fechado: 1 });
    await page.getByRole("radio", { name: "Jornada" }).click();
    await expect(page).toHaveURL(/\/jornada$/);

    // Clicar na estação abre a Fila só com aquela etapa
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Lead: 3 leads/ }).click();
    await expect(page).toHaveURL(/\/atendimento\?etapa=lead$/);
    await expect(page.getByRole("status").filter({ hasText: "Mostrando: etapa Lead" })).toBeVisible();
    const fila = page.getByRole("listbox", { name: "Fila" });
    await expect(fila.getByRole("option")).toHaveCount(3);
    await expect(fila.getByRole("option", { name: /Elaine Pacheco/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Mostrar todos" }).click();
    await expect(page).toHaveURL(/view=todos/);

    // Follow-up junta Follow-up 1 e 2
    await page.goto("/jornada");
    await page.locator('[data-station="followup"]').getByRole("link", { name: /^Follow-up: 2 leads/ }).click();
    await expect(page).toHaveURL(/etapa=followup$/);
    await expect(fila.getByRole("option")).toHaveCount(2);
    // Uma pessoa leva ao lead
    await page.goto("/jornada");
    await page.locator('[data-station="lead"]').getByRole("link", { name: /Tatiane Moura/ }).click();
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
    await expect(lead.getByRole("link", { name: /^Lead: 14 leads/ })).toBeVisible();
    await expect(lead.getByRole("list", { name: "Pessoas em Lead" }).getByRole("listitem")).toHaveCount(13); // 12 pessoas + o "+2"
    await expect(lead.getByRole("link", { name: "Mais 2 em Lead" })).toHaveText("+2");
    await lead.getByRole("link", { name: "Mais 2 em Lead" }).click();
    await expect(page).toHaveURL(/etapa=lead$/);
  });

  test("a atendente não acessa a Jornada: sem aba, sem menu e a rota dá 404", async ({ page }) => {
    await login(page, "ana@e2e.local");
    await page.goto("/atendimento");
    await expect(page.getByRole("radio", { name: "Jornada" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Jornada" })).toHaveCount(0);
    const r = await page.goto("/jornada");
    expect(r?.status()).toBe(404);
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
  test("as estações empilham, sem rolagem lateral, com alvos de 44 px, e o menu Mais leva à Jornada", async ({ page, isMobile }) => {
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
    // Mais → Jornada
    await page.getByRole("button", { name: "Mais" }).click();
    await page.getByRole("dialog", { name: "Mais" }).getByRole("link", { name: "Jornada" }).click();
    await expect(page).toHaveURL(/\/jornada$/);
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Lead: 3 leads/ }).click();
    await expect(page).toHaveURL(/etapa=lead$/);
  });
});
