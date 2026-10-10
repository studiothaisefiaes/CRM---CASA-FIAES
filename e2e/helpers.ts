import { expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Estado de sessão salvo pelo projeto `setup` (e2e/auth.setup.ts), um por papel. */
export const AUTH_FILE: Record<string, string> = { "gestao@e2e.local": "e2e/.auth/gestao.json", "ana@e2e.local": "e2e/.auth/ana.json" };

/** Entra reaproveitando a sessão do `setup` (sem passar pelo formulário). Troca de usuário limpando antes os cookies. */
export async function login(page: Page, email = "gestao@e2e.local") {
  const file = AUTH_FILE[email];
  if (!file) throw new Error(`sem sessão salva para ${email}: use loginReal`);
  const state = JSON.parse(readFileSync(file, "utf8")) as { cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

/** Login de verdade pelo formulário. Conta no limite de tentativas: só o setup e o spec de login usam. */
export async function loginReal(page: Page, email = "gestao@e2e.local", password = "senha-e2e-123") {
  // Até 3 tentativas: se o dev server recarregar a página no meio (compilação), o formulário some e a tentativa recomeça do /login.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto("/login");
      await page.getByLabel("E-mail").fill(email, { timeout: 8000 });
      await page.getByLabel("Senha").fill(password, { timeout: 8000 });
      await page.getByRole("button", { name: "Entrar" }).click({ timeout: 8000 });
      await expect(page).toHaveURL(/\/$/, { timeout: 8000 });
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
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
export async function shot(page: Page, name: string, opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) {
  const dir = process.env.CF_SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(700); // fim das animações de entrada
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage, clip: opts.clip });
}
