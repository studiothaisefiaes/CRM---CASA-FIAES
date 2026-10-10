import { expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

export async function login(page: Page, email = "gestao@e2e.local", password = "senha-e2e-123") {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function simulate(page: Page, opts: { phone: string; name: string; text: string; fromMe?: boolean }) {
  await page.goto("/dev/simulador");
  await page.getByLabel("Telefone do cliente").fill(opts.phone);
  await page.getByLabel("Nome no WhatsApp").fill(opts.name);
  await page.getByLabel("Mensagem").fill(opts.text);
  if (opts.fromMe) await page.getByLabel(/Enviada pela Casa/).check();
  await page.getByRole("button", { name: "Enviar evento" }).click();
  await expect(page.locator("pre")).toContainText(/dealId|duplicate/);
}

/** Volta o relógio da espera de um lead e roda o motor de automações (simula a passagem do tempo). */
export function ageLead(phoneE164: string, minutes: number) {
  const url = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
  execSync(`npx tsx e2e/envelhecer.ts ${phoneE164} ${minutes}`, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}

const e2eUrl = () => (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");

/** SQL direto no banco de e2e (preparar estado que a tela não cria: canal em erro, modo quieto…). */
export async function e2eSql(text: string, params: unknown[] = []) {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: e2eUrl() });
  await c.connect();
  try { return (await c.query(text, params)).rows as Record<string, unknown>[]; } finally { await c.end(); }
}

/** Salva um print em CF_SHOTS_DIR (headless); sem a variável, não faz nada. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  const dir = process.env.CF_SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(700); // fim das animações de entrada
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage });
}
