import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UserFacingError } from "../domain/errors";

/**
 * Qual Chromium gera o PDF (QA r66, I-5: o relatório mensal falhou 4 dias seguidos em produção por "PDF indisponível"). O Playwright
 * guarda o navegador numa pasta por usuário (`~/.cache/ms-playwright`; em produção, `/home/crm/.cache/ms-playwright`) e a revisão tem de bater
 * com a do `playwright-core` instalado. Aqui: o caminho que o Playwright espera; se não existe, o mesmo arquivo nas outras pastas conhecidas
 * (o worker pode rodar com outro HOME); se nada serve, um erro que diz o que falta e onde, em vez do genérico.
 */
export const PROD_BROWSERS_DIR = "/home/crm/.cache/ms-playwright";
const MARK = "ms-playwright";

export function browserDirs(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  const list = [env.PLAYWRIGHT_BROWSERS_PATH, join(home, ".cache", MARK), PROD_BROWSERS_DIR].filter((d): d is string => !!d && d !== "0");
  return [...new Set(list)];
}

export const CHROMIUM_MISSING = (expected: string, dirs: string[]) =>
  `PDF indisponível neste servidor: falta o Chromium do Playwright (esperado em ${expected}; procurei em ${dirs.join(", ")}). Quem cuida do servidor instala com "npx playwright install chromium" como o usuário do CRM.`;

export function findChromium(deps: { expectedPath: string; dirs: string[]; exists?: (p: string) => boolean }): string {
  const exists = deps.exists ?? existsSync;
  if (exists(deps.expectedPath)) return deps.expectedPath;
  const i = deps.expectedPath.lastIndexOf(`${MARK}/`);
  const rel = i >= 0 ? deps.expectedPath.slice(i + MARK.length + 1) : null; // "chromium-1248/chrome-linux/chrome"
  if (rel) for (const d of deps.dirs) { const p = join(d, rel); if (exists(p)) return p; }
  throw new UserFacingError(CHROMIUM_MISSING(deps.expectedPath, deps.dirs));
}

/** O caminho do Chromium certo neste servidor, ou o erro claro. */
export function chromiumExecutable(chromium: { executablePath(): string }): string {
  return findChromium({ expectedPath: chromium.executablePath(), dirs: browserDirs() });
}
