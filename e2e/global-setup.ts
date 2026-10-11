import "dotenv/config";
import { execSync } from "node:child_process";
import { chromium, type FullConfig } from "@playwright/test";

/**
 * Aquece o servidor de dev com um navegador de verdade antes dos testes.
 *
 * O `setup` já travou em /login: o dev server (Turbopack) manda recarregar a página enquanto compila uma rota pela primeira vez ou depois de
 * trocar arquivos, e uma recarga em laço desprende o botão "Entrar" a cada tentativa (o trace mostrou centenas de GET /login e nenhum POST).
 * Não é o limite de tentativas de login (não houve POST), nem servidor velho (o Playwright recusa subir se a porta já está em uso).
 * Aqui esperamos o /login ficar parado por 2 s seguidos; se o servidor não estabilizar, a execução falha logo, com o motivo, em vez de travar 60 s.
 */
async function warmUp(baseURL: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let loads = 0, last = Date.now();
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) { loads++; last = Date.now(); } });
    await page.goto(`${baseURL}/login`);
    const start = Date.now();
    while (Date.now() - last < 2000) {
      if (Date.now() - start > 90_000) throw new Error(`O servidor de e2e não estabilizou: /login recarregou ${loads} vezes em 90 s (recarga em laço do dev server). Apague .next-e2e e rode de novo.`);
      await page.waitForTimeout(250);
    }
    if (loads > 3) console.warn(`[e2e] /login recarregou ${loads} vezes até o dev server estabilizar`);
  } finally { await browser.close(); }
}

export default async function globalSetup(config: FullConfig) {
  const url = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx drizzle-kit migrate", { env, stdio: "inherit" });
  execSync(`npx tsx e2e/reset.ts`, { env, stdio: "inherit" });
  const baseURL = config.projects.find((p) => p.use.baseURL)?.use.baseURL;
  if (!baseURL) throw new Error("baseURL do e2e não configurada");
  await warmUp(baseURL);
}
