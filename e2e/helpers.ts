import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** Estado de sessão salvo pelo projeto `setup` (e2e/auth.setup.ts), um por papel. */
export const AUTH_FILE: Record<string, string> = { "gestao@e2e.local": "e2e/.auth/gestao.json", "ana@e2e.local": "e2e/.auth/ana.json", "maiara@e2e.local": "e2e/.auth/maiara.json" };

/** Onde cada pessoa cai ao entrar: a profissional (só o app) vai para /pro. */
const LANDING: Record<string, string> = { "maiara@e2e.local": "/pro" };
const landingOf = (email: string) => LANDING[email] ?? "/";

/** Entra reaproveitando a sessão do `setup` (sem passar pelo formulário). Troca de usuário limpando antes os cookies. */
export async function login(page: Page, email = "gestao@e2e.local") {
  const file = AUTH_FILE[email];
  if (!file) throw new Error(`sem sessão salva para ${email}: use loginReal`);
  const state = JSON.parse(readFileSync(file, "utf8")) as { cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
  await page.goto(landingOf(email));
  await expect(page).toHaveURL(new RegExp(`${landingOf(email).replace(/\//g, "\\/")}$`));
}

/** O servidor recusou o login (senha errada, limite de tentativas): tentar de novo só gasta o limite, que é por IP e vale para a suíte toda. */
class LoginRecusado extends Error {}

/** Login de verdade pelo formulário. Conta no limite de tentativas: só o setup e o spec de login usam. */
export async function loginReal(page: Page, email = "gestao@e2e.local", password = "senha-e2e-123") {
  // Até 3 tentativas, só quando o formulário some no meio (o dev server recarrega a página ao compilar): a tentativa recomeça do /login.
  // Se o servidor responde com erro (senha errada, limite), falha na hora, com a mensagem da tela.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto("/login");
      // A tentativa anterior entrou, mas a primeira página demorou mais que o prazo para compilar (máquina carregada): o /login já manda para dentro.
      if (attempt > 1 && new URL(page.url()).pathname === landingOf(email)) return;
      await page.getByLabel("E-mail").fill(email, { timeout: 8000 });
      await page.getByLabel("Senha").fill(password, { timeout: 8000 });
      await page.getByRole("button", { name: "Entrar" }).click({ timeout: 8000 });
      const erro = page.locator("form").getByRole("alert"); // o aviso do formulário (senha errada, muitas tentativas)
      const entrou = () => new URL(page.url()).pathname === landingOf(email);
      await expect.poll(async () => entrou() || (await erro.count()) > 0, { timeout: 30_000 }).toBe(true); // a primeira página compila no dev server (lenta com a máquina carregada)
      if (!entrou()) throw new LoginRecusado(`login recusado para ${email}: ${(await erro.first().innerText()).trim()}`);
      return;
    } catch (e) {
      if (e instanceof LoginRecusado || attempt >= 3) throw e;
    }
  }
}

export async function simulate(page: Page, opts: { phone: string; name: string; text: string; fromMe?: boolean }) {
  await page.goto("/dev/simulador");
  await page.getByLabel("Telefone do cliente").fill(opts.phone);
  await page.getByLabel("Nome no WhatsApp").fill(opts.name);
  await page.getByLabel("Mensagem", { exact: true }).fill(opts.text);
  if (opts.fromMe) await page.getByLabel(/Enviada pela Casa/).check();
  await page.getByRole("button", { name: "Enviar evento" }).click();
  await expect(page.locator("pre")).toContainText(/dealId|duplicate/);
}

/** Volta o relógio da espera de um lead e roda o motor de automações (simula a passagem do tempo). */
export function ageLead(phoneE164: string, minutes: number) {
  const url = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
  execSync(`npx tsx e2e/envelhecer.ts ${phoneE164} ${minutes}`, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, EVOLUTION_URL: "http://127.0.0.1:9" } }); // nunca a Evolution real
}

const e2eUrl = () => (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");

/** Refaz a visão por contato (Lote 2) no banco de e2e com o mesmo script de produção (`--aplicar`). Nunca a Evolution real. */
export function refreshStatsE2E() {
  execSync("npx tsx scripts/visao-contatos.ts --aplicar", { stdio: "inherit", env: { ...process.env, DATABASE_URL: e2eUrl(), EVOLUTION_URL: "http://127.0.0.1:9" } });
}

/** SQL direto no banco de e2e (preparar estado que a tela não cria: canal em erro, modo quieto…). */
export async function e2eSql(text: string, params: unknown[] = []) {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: e2eUrl() });
  await c.connect();
  try { return (await c.query(text, params)).rows as Record<string, unknown>[]; } finally { await c.end(); }
}

/**
 * Deixa na Fila só os leads cujo telefone começa pelo prefixo: os outros specs deixam leads para trás no banco de e2e compartilhado.
 * Resolve os avisos abertos e arquiva o resto (não apaga nada).
 */
export async function isola(prefixo: string) {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${prefixo}%`]);
}

/** Salva um print em CF_SHOTS_DIR (headless); sem a variável, não faz nada. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) {
  const dir = process.env.CF_SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(700); // fim das animações de entrada
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage, clip: opts.clip });
}

const ISOLADOS = "e2e/.auth/isolados.json";
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Para os specs que precisam de um quadro só deles (Quadro, Jornada), num banco de e2e compartilhado (os relatórios somam as vendas do dia, por exemplo).
 * Chame no topo do arquivo: antes de tudo os leads que já existiam saem de cena (arquivados) e, no fim, os do spec saem e os de antes voltam.
 * Autorrecuperável: os ids guardados ficam em disco (`e2e/.auth/isolados.json`), então se uma execução cair no meio, a próxima devolve os leads
 * antes de guardar de novo. Devolve `isola()`, para cada teste começar de um quadro limpo (avisos resolvidos e leads dos testes anteriores arquivados).
 */
export function usaQuadroIsolado() {
  const devolve = async (lista: string[]) => { if (lista.length) await e2eSql("update deals set archived_at = null where id = any($1)", [lista]); };
  test.beforeAll(async () => {
    if (existsSync(ISOLADOS)) await devolve(ids(JSON.parse(readFileSync(ISOLADOS, "utf8")))); // sobra de uma execução interrompida
    const existentes = (await e2eSql("select id from deals where archived_at is null")).map((r) => r.id as string);
    writeFileSync(ISOLADOS, JSON.stringify(existentes));
    await e2eSql("update deals set archived_at = now() where id = any($1)", [existentes]);
  });
  test.afterAll(async () => {
    await e2eSql("update deals set archived_at = now() where archived_at is null");
    await devolve(ids(JSON.parse(readFileSync(ISOLADOS, "utf8"))));
    rmSync(ISOLADOS, { force: true });
  });
  return async function isola() {
    await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
    await e2eSql("update deals set archived_at = now() where archived_at is null");
  };
}

