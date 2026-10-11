import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql } from "./helpers";

/**
 * Critérios de conclusão da spec (§12) que ainda não tinham e2e próprio. O mapa completo critério → teste fica no ledger
 * (.superpowers/sdd/2026-10-09-crm-melhorias-completas/progress.md) e no relatório da Task 25.
 * Só simulador e banco de e2e (DEV_TOOLS): nenhum número real, nenhum envio.
 */

test.describe.configure({ mode: "serial" });

/** Deixa na Fila só os leads do prefixo (os outros specs deixam leads para trás) e resolve os avisos antigos. */
async function isola(prefixo: string) {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${prefixo}%`]);
}
const leadId = async (phone: string) =>
  String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [phone]))[0].id);
const fila = (page: Page) => page.getByRole("listbox", { name: "Fila" });
const rolagem = (page: Page) => fila(page).evaluate((el) => el.scrollTop);

test("critério 1 (desktop): sair da Fila e voltar pela barra lateral mantém filtro, rolagem e o lead aberto", async ({ page, isMobile }) => {
  test.skip(isMobile, "o celular está em fila.spec (voltar da conversa) e conversa.spec (responder e próximo)");
  await login(page);
  await isola("+55719974500");
  for (let i = 1; i <= 16; i++) await simulate(page, { phone: `71 99745-00${String(i).padStart(2, "0")}`, name: `Critério ${i}`, text: "Oi, tem horário?" });
  await page.goto("/atendimento?view=todos");
  await expect(fila(page).getByRole("option")).toHaveCount(16);
  expect(await fila(page).evaluate((el) => el.scrollHeight > el.clientHeight + 300), "a lista precisa rolar").toBe(true);
  await fila(page).evaluate((el) => { el.scrollTop = 300; });
  await expect.poll(() => rolagem(page)).toBe(300);
  const alvo = fila(page).getByRole("option").nth(8);
  await alvo.click();
  const id = await alvo.getAttribute("data-deal-id");
  await expect(page).toHaveURL(new RegExp(`lead=${id}`));
  await expect(page.getByRole("region", { name: /^Lead / })).toBeVisible();
  const antes = await rolagem(page);
  expect(antes).toBeGreaterThan(200);

  // Outra tela e volta pela barra lateral: o mesmo filtro, a mesma rolagem e o mesmo lead aberto.
  await page.goto("/relatorios");
  await page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Atendimento" }).click();
  await expect(page).toHaveURL(/view=todos/);
  await expect(page).toHaveURL(new RegExp(`lead=${id}`));
  await expect(fila(page).getByRole("option")).toHaveCount(16);
  await expect.poll(() => rolagem(page)).toBeGreaterThanOrEqual(antes - 2);
  expect(await rolagem(page)).toBeLessThanOrEqual(antes + 2);
  await expect(fila(page).locator(`[data-deal-id="${id}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: /^Lead / })).toBeVisible();
});

test("critério 2 (e2e): fora do expediente não é atraso; com a Casa aberta, a mesma espera vira atrasado", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997460001");
  await simulate(page, { phone: "71 99746-0001", name: "Olga Ramos", text: "Oi, vocês abrem amanhã?" });
  const id = await leadId("+5571997460001");
  const alertasAbertos = async () => Number((await e2eSql("select count(*)::int as n from alerts where deal_id = $1 and resolved_at is null", [id]))[0].n);
  const original = (await e2eSql("select value from settings where key = 'business_hours'"))[0].value;
  try {
    // Expediente de 1 h, 12 h longe da hora atual em Salvador: agora a Casa está fechada, todos os dias.
    const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bahia", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const ini = (hora + 12) % 24;
    const janela = [`${String(ini).padStart(2, "0")}:00`, ini === 23 ? "24:00" : `${String(ini + 1).padStart(2, "0")}:00`];
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, janela])))]);

    ageLead("+5571997460001", 30); // 30 min sem resposta, todos com a Casa fechada; o motor roda
    expect(await alertasAbertos(), "fora do expediente o motor não abre alerta").toBe(0);
    await page.goto(`/atendimento?lead=${id}`);
    const porque = page.getByRole("region", { name: "Dados do cliente" }).getByTestId("por-que-atrasou");
    await expect(porque).toContainText(/Sem resposta da Casa desde .+ — Casa fechada/);
    await expect(porque).not.toContainText("ninguém respondeu");
    await page.goto("/atendimento?filtro=atrasados");
    await expect(page.getByRole("status").filter({ hasText: "Mostrando: leads atrasados" })).toBeVisible();
    await expect(fila(page).getByRole("option", { name: /Olga Ramos/ })).toHaveCount(0);
  } finally {
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(original)]);
  }

  // Casa aberta (24 h no banco de e2e): a mesma espera de 30 min passa do prazo de 2 min e vira atrasado.
  ageLead("+5571997460001", 30);
  await expect.poll(alertasAbertos).toBeGreaterThan(0);
  await page.goto(`/atendimento?lead=${id}`);
  await expect(page.getByRole("region", { name: "Dados do cliente" }).getByTestId("por-que-atrasou"))
    .toContainText(/ninguém respondeu \(\d+ min no expediente; prazo 2 min\)/);
  await page.goto("/atendimento?filtro=atrasados");
  await expect(fila(page).getByRole("option", { name: /Olga Ramos/ })).toBeVisible();
});

test("critério 10 (rota + cabeçalhos no servidor de verdade): CSP com nonce, nosniff e a rota de mídia fechada", async ({ page, playwright, baseURL, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  // Cabeçalhos globais (S2) numa página autenticada
  const res = await page.request.get("/");
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toMatch(/img-src 'self' data: blob:/);
  expect(h["content-security-policy"]).toMatch(/media-src 'self' blob:/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
  expect(h["permissions-policy"]).toMatch(/geolocation=\(\)/);
  // O nonce muda a cada requisição
  const outro = (await page.request.get("/")).headers()["content-security-policy"];
  expect(outro.match(/'nonce-([^']+)'/)?.[1]).not.toBe(h["content-security-policy"].match(/'nonce-([^']+)'/)?.[1]);

  // Rota de mídia (S1): sem sessão válida é 401; id malformado ou inexistente é 404; mídia apagada pela retenção é 410. Sempre com nosniff.
  const anon = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: "cf_session=sessao-falsa" } });
  const r401 = await anon.get("/api/media/00000000-0000-4000-8000-000000000000");
  expect(r401.status()).toBe(401);
  expect(r401.headers()["x-content-type-options"]).toBe("nosniff");
  await anon.dispose();
  for (const bad of ["nao-e-uuid", "00000000-0000-4000-8000-000000000000"]) {
    const r = await page.request.get(`/api/media/${bad}`);
    expect(r.status(), bad).toBe(404);
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  }
  await simulate(page, { phone: "71 99747-0001", name: "Ivone Prado", text: "Mandei a foto" });
  const [m] = await e2eSql(`insert into messages (deal_id, contact_id, direction, kind, body, status, media_path, media_mime, media_purged_at)
    select d.id, d.contact_id, 'in', 'image', null, 'received', 'nao-existe.jpg', 'image/jpeg', now() from deals d join contacts c on c.id = d.contact_id
    where c.phone_e164 = '+5571997470001' and d.archived_at is null returning id`);
  const r410 = await page.request.get(`/api/media/${m.id}`);
  expect(r410.status()).toBe(410);
  expect(r410.headers()["x-content-type-options"]).toBe("nosniff");
});

test("critério 12 (e2e): /api/health mostra banco, worker e WhatsApp", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const r = await page.request.get("/api/health");
  expect(r.status()).toBe(200); // ok ou degraded (sem worker no e2e) respondem 200; só banco fora é 503
  const body = await r.json();
  expect(body).toMatchObject({ db: true, worker: { ok: expect.any(Boolean) }, whatsapp: expect.any(Array) });
  expect(["ok", "degraded"]).toContain(body.status);
});

test("critério 13: o que depende do Avec aparece como bloqueado, sem número; axe limpo na Análise e no diálogo de importar", async ({ page }) => {
  const axe = async (rotulo: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id), rotulo).toEqual([]);
  };
  await login(page);
  await page.goto("/relatorios?aba=analise&periodo=mes");
  const coorte = page.getByRole("region", { name: "Retorno por coorte" });
  await expect(coorte).toBeVisible();
  await expect(coorte.getByText("Bloqueado", { exact: true })).toBeVisible();
  await expect(coorte).toContainText("Depende da exportação de atendimentos do Avec, que ainda não está disponível.");
  expect(await coorte.innerText(), "sem número nem dado inventado").not.toMatch(/\d/);
  await expect(coorte.locator("svg, table, [aria-busy]")).toHaveCount(0);
  await page.waitForTimeout(1500); // fim das animações de entrada (contraste no meio do fade dá falso positivo)
  await axe("análise com coorte bloqueada");

  await page.goto("/contatos");
  await page.getByRole("button", { name: "Importar clientes" }).click();
  const dlg = page.getByRole("dialog", { name: "Importar histórico de clientes" });
  await expect(dlg.getByText("Importação periódica do Avec: bloqueada até a Casa liberar a exportação.")).toBeVisible();
  await page.waitForTimeout(500);
  await axe("diálogo de importar com Avec bloqueado");
});
