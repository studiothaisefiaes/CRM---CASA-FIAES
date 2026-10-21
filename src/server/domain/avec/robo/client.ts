import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { AvecLoginError, type AvecSource } from "./run";

export type AvecCredentials = { email: string; senha: string; slug?: string; baseUrl?: string };

/**
 * O Avec de verdade: um Chromium sem janela entra uma vez com a conta da Casa e, para cada relatório, abre a tela e lê as linhas pela
 * mesma rota que a tela usa (`admin/relatorios/listar`, JSON). SÓ LEITURA: nunca clica em salvar/excluir/finalizar e nunca em "Sair"
 * (o Sair derrubaria a sessão da recepção); ao terminar só fecha o navegador.
 */
export class PlaywrightAvecSource implements AvecSource {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly base: string;
  constructor(private readonly cred: AvecCredentials) { this.base = cred.baseUrl ?? "https://admin.avec.beauty"; }

  private async login(): Promise<Page> {
    this.browser = await chromium.launch({ headless: true });
    this.ctx = await this.browser.newContext({ locale: "pt-BR", timezoneId: "America/Bahia" });
    const page = await this.ctx.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`${this.base}/${this.cred.slug ?? "studiothaisefiaes"}/admin`, { waitUntil: "domcontentloaded" });
    const email = page.locator('input[type="email"]').first();
    const pass = page.locator('input[type="password"]').first();
    try { await pass.waitFor({ state: "visible", timeout: 30_000 }); }
    catch { throw new AvecLoginError("O Avec mudou a tela de entrada (não achei os campos de e-mail e senha)."); }
    await email.fill(this.cred.email);
    await pass.fill(this.cred.senha);
    await page.getByRole("button", { name: /acessar conta/i }).click();
    try { await pass.waitFor({ state: "detached", timeout: 45_000 }); }
    catch { throw new AvecLoginError("O Avec não aceitou o login da Casa (senha trocada ou tela nova)."); }
    this.page = page;
    return page;
  }

  async fetchReport(code: string, params: Record<string, string>): Promise<{ headers: string[]; aaData: unknown }> {
    const page = this.page ?? (await this.login());
    await page.goto(`${this.base}/admin/relatorio/${code}`, { waitUntil: "domcontentloaded" });
    if (await page.locator('input[type="password"]').count()) throw new AvecLoginError("O Avec pediu a senha de novo (sessão caiu).");
    const out = await page.evaluate(async ({ params }) => {
      const form = [...document.forms].find((f) => f.querySelector("[name=relatorio]"));
      const th = [...document.querySelectorAll("#tableFilter thead th")].map((h) => (h.textContent ?? "").trim());
      if (!form || !th.length) return { error: "tela do relatório sem formulário ou sem colunas" };
      const q = new URLSearchParams();
      for (const e of Array.from(form.elements) as HTMLInputElement[]) if (e.name) q.set(e.name, e.value ?? "");
      for (const [k, v] of Object.entries(params)) q.set(k, v);
      const r = await fetch(`/admin/relatorios/listar?${q}`, { credentials: "include" });
      const t = await r.text();
      try { const j = JSON.parse(t); return { headers: th, aaData: j.aaData }; } catch { return { error: `resposta não é JSON (HTTP ${r.status})` }; }
    }, { params });
    if ("error" in out) throw new Error(`${code}: ${out.error}`);
    return out;
  }

  /** Fecha o navegador sem sair da conta. */
  async close(): Promise<void> { await this.browser?.close().catch(() => {}); this.browser = this.ctx = this.page = null; }
}
