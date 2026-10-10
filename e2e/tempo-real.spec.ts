import { test, expect, type Page } from "@playwright/test";
import { login, e2eSql } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Conta as requisições de navegação/RSC (router.refresh) para um caminho; ignora /api e arquivos estáticos. */
function countPage(page: Page, path: string) {
  const hits: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === path && !u.pathname.startsWith("/api")) hits.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  return hits;
}

/** Espera a conexão SSE abrir (os avisos só chegam depois). */
async function openStream(page: Page, goto: () => Promise<unknown>) {
  const stream = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/stream");
  await goto();
  await stream;
  await page.waitForTimeout(500); // LISTEN do servidor pronto
}

/** NOTIFY direto no banco de e2e: o mesmo caminho do emit, sem enviar nada a ninguém. */
const notify = (payload: Record<string, unknown>) => e2eSql("select pg_notify('crm_events', $1)", [JSON.stringify(payload)]);

test("com Relatórios aberto, mensagem não gera GET /relatorios; venda sim; rajada vira 1 refresh; Funil recarrega", async ({ page }) => {
  await login(page);
  const hits = countPage(page, "/relatorios");
  await openStream(page, () => page.goto("/relatorios?periodo=mes"));
  await expect(page.getByRole("heading", { name: "Os números do período" })).toBeVisible();
  await page.waitForTimeout(500);

  // 1. Mensagens (inclusive várias seguidas) não tocam nos Relatórios.
  hits.length = 0;
  for (let i = 0; i < 5; i++) await notify({ type: "mensagem_recebida", dealId: "00000000-0000-4000-8000-000000000001" });
  await notify({ type: "mensagem_enviada", dealId: "00000000-0000-4000-8000-000000000001" });
  await page.waitForTimeout(2000);
  expect(hits, "mensagem não pode recarregar Relatórios").toEqual([]);

  // 2. Controle positivo: o medidor enxerga um refresh quando o aviso é do escopo da tela.
  await notify({ type: "venda", dealId: "00000000-0000-4000-8000-000000000001" });
  await expect.poll(() => hits.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1200);

  // 3. Rajada de 20 avisos em sequência vira um refresh só.
  hits.length = 0;
  await Promise.all(Array.from({ length: 20 }, () => notify({ type: "alerta" })));
  await page.waitForTimeout(2500);
  expect(hits.length, `refreshes: ${hits.join(" | ")}`).toBe(1);

  // 4. Funil: mensagem recarrega; tipo desconhecido também (fail-open). Reaproveita o login (o limite de tentativas é por IP).
  const funil = countPage(page, "/funil");
  await openStream(page, () => page.goto("/funil"));
  await expect(page.getByRole("heading", { name: "Funil" })).toBeVisible();
  await page.waitForTimeout(500);
  funil.length = 0;
  await notify({ type: "mensagem_recebida", dealId: "00000000-0000-4000-8000-000000000002" });
  await expect.poll(() => funil.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1200);
  funil.length = 0;
  await notify({ type: "relatorio_pronto" }); // tipo desconhecido: fail-open, atualiza mesmo assim
  await expect.poll(() => funil.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
});
