import { test, expect } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot, usaQuadroIsolado } from "./helpers";

test.describe.configure({ mode: "serial" });

// Conta quantos osciladores o som de alerta cria (playAlert cria 2 por toque).
const countBeeps = `(() => { window.__beeps = 0; const C = window.AudioContext;
  window.AudioContext = class extends C { createOscillator() { window.__beeps++; return super.createOscillator(); } }; })();`;

// O motor (ageLead) roda para o banco todo: lead esperando que outro spec deixou para trás também vira "atrasado" e muda a contagem do título.
// Cada teste começa só com os leads dele (os de fora ficam arquivados e voltam no fim do arquivo).
const isola = usaQuadroIsolado();

test.beforeEach(async () => {
  await isola(); // resolve os avisos abertos e arquiva os leads dos testes anteriores
  await e2eSql("delete from channels where instance_name like 'e2e-banner-%'");
});
test.afterEach(async () => { await e2eSql("delete from channels where instance_name like 'e2e-banner-%'"); });

test("título e som: lead que estoura o prazo muda a aba uma vez só", async ({ page }) => {
  await page.addInitScript(countBeeps);
  await login(page);
  await simulate(page, { phone: "71 99700-5001", name: "Paula Neri", text: "Oi, quero horário." });
  await page.goto("/");
  await expect(page.getByTestId("late-live")).toBeAttached();
  const base = await page.title();
  expect(base).not.toContain("atrasados");
  expect(await page.evaluate(() => (window as unknown as { __beeps: number }).__beeps)).toBe(0);

  ageLead("+5571997005001", 11); // passa do prazo da etapa Lead (2 min); o motor avisa e a tela atualiza sozinha
  await expect(page).toHaveTitle("(1) atrasados · Casa Fiaes");
  await expect(page.getByTestId("late-live")).toHaveText("1 lead atrasado");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __beeps: number }).__beeps)).toBe(2);

  // Navegar mantém o título; recarregar não toca de novo (primeiro render não conta).
  await page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Atendimento" }).click();
  await expect(page).toHaveURL(/\/atendimento/);
  await expect(page).toHaveTitle("(1) atrasados · Casa Fiaes");
  await page.reload();
  await expect(page).toHaveTitle("(1) atrasados · Casa Fiaes");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { __beeps: number }).__beeps)).toBe(0);

  // Respondeu: o alerta resolve e o título volta ao da página.
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await page.reload();
  await expect(page).not.toHaveTitle(/atrasados/);
});

test("aba em segundo plano: 2 -> 1 -> 0 atrasados atualiza título e som sem recarregar", async ({ page }) => {
  // Aba "oculta": o LiveProvider não roda router.refresh, então só a consulta a /api/alertas/atrasados pode mudar o título.
  await page.addInitScript(countBeeps);
  await page.addInitScript(() => { Object.defineProperty(document, "visibilityState", { get: () => "hidden" }); });
  await login(page);
  await simulate(page, { phone: "71 99700-5011", name: "Rita Alves", text: "Oi!" });
  await simulate(page, { phone: "71 99700-5012", name: "Sara Lopes", text: "Oi!" });
  await page.goto("/");
  const base = await page.title();
  const beeps = () => page.evaluate(() => (window as unknown as { __beeps: number }).__beeps);
  ageLead("+5571997005011", 11);
  await expect(page).toHaveTitle("(1) atrasados · Casa Fiaes", { timeout: 15_000 });
  ageLead("+5571997005012", 11);
  await expect(page).toHaveTitle("(2) atrasados · Casa Fiaes", { timeout: 15_000 });
  await expect(page.getByTestId("late-live")).toHaveText("2 leads atrasados");
  expect(await beeps()).toBe(4); // um toque por subida (2 osciladores cada)

  const resolve = async (name: string) => {
    await e2eSql("update alerts set resolved_at = now() where message like $1 and resolved_at is null", [`%${name}%`]);
    await e2eSql(`select pg_notify('crm_events', '{"type":"regras"}')`);
  };
  await resolve("Rita Alves");
  await expect(page).toHaveTitle("(1) atrasados · Casa Fiaes", { timeout: 15_000 });
  await resolve("Sara Lopes");
  await expect(page).toHaveTitle(base, { timeout: 15_000 }); // não fica preso em "(1) atrasados"
  expect(await beeps()).toBe(4); // descer não toca
});

test("banner de conexão aparece com canal em erro e some com canal removido", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status) values ('Salão', 'e2e-banner-1', 'erro')");
  await login(page);
  const banner = page.getByTestId("banner-conexao");
  await expect(banner).toContainText("O WhatsApp Salão está desconectado.");
  await expect(banner.getByRole("link", { name: "Reconectar" })).toHaveAttribute("href", "/config/whatsapp");
  await shot(page, "02-banner-erro");
  await e2eSql("update channels set name = 'Salão (removido)' where instance_name = 'e2e-banner-1'");
  await page.reload();
  await expect(page.getByTestId("banner-conexao")).toHaveCount(0);
});

test("banner do modo quieto mostra a hora e a gestão retoma os avisos", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status, quiet_until) values ('Salão', 'e2e-banner-2', 'conectado', now() + interval '3 hours')");
  await login(page);
  const banner = page.getByTestId("banner-quieto");
  await expect(banner).toContainText(/Número recém-conectado: avisos pausados até (amanhã )?\d{2}:\d{2}/);
  await shot(page, "03-banner-quieto");
  await banner.getByRole("button", { name: "Retomar avisos agora" }).click();
  const confirm = page.getByRole("dialog", { name: "Retomar avisos agora?" });
  await expect(confirm).toContainText("Os avisos voltam para todas as conversas desse número, inclusive as antigas.");
  await confirm.getByRole("button", { name: "Cancelar" }).click(); // cancelar não mexe em nada
  const [still] = await e2eSql("select quiet_until from channels where instance_name = 'e2e-banner-2'");
  expect(still.quiet_until).not.toBeNull();
  await banner.getByRole("button", { name: "Retomar avisos agora" }).click();
  await confirm.getByRole("button", { name: "Retomar agora" }).click();
  await expect(page.getByTestId("banner-quieto")).toHaveCount(0);
  const [row] = await e2eSql("select quiet_until from channels where instance_name = 'e2e-banner-2'");
  expect(row.quiet_until).toBeNull();
});

test("atendente vê o banner do modo quieto, mas sem o botão de retomar", async ({ page }) => {
  await e2eSql("insert into channels (name, instance_name, status, quiet_until) values ('Salão', 'e2e-banner-3', 'conectado', now() + interval '3 hours')");
  await login(page, "ana@e2e.local");
  await expect(page.getByTestId("banner-quieto")).toContainText("avisos pausados até");
  await expect(page.getByRole("button", { name: "Retomar avisos agora" })).toHaveCount(0);
});

test("sino no desktop: Esc fecha e devolve o foco", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99700-5002", name: "Lia Dantas", text: "Oi!" });
  ageLead("+5571997005002", 11);
  await page.goto("/");
  const bell = page.getByRole("button", { name: /Alertas, [1-9]/ }).first();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Alertas" });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('[data-testid="alerts-panel"]')?.parentElement === document.body)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(bell).toBeFocused();
});
