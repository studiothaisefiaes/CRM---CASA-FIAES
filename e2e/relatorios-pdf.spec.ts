import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { login, simulate, e2eSql } from "./helpers";

// PDFs dos Relatórios: o servidor gera com o Chromium; quem não exporta recebe 403.
const ANA = "ana@e2e.local";

test.describe("relatórios em PDF", () => {
  test.skip(({ isMobile }) => isMobile, "desktop");
  test.afterEach(() => e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]));

  test("baixar o PDF do período e o por atendente pela tela; Recepção não baixa", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await login(page);
    await simulate(page, { phone: "71 99704-0001", name: "Paula Pdf", text: "Oi, quanto custa a progressiva?" });
    const per = await page.request.get("/api/relatorios/pdf?tipo=periodo&periodo=mes", { timeout: 120_000 });
    expect(per.status(), await per.text().catch(() => "")).toBe(200);
    const body = await per.body();
    expect(body.subarray(0, 4).toString()).toBe("%PDF");
    expect(body.length).toBeGreaterThan(10_000);
    mkdirSync("e2e/shots/relatorios-pdf", { recursive: true });
    writeFileSync("e2e/shots/relatorios-pdf/periodo.pdf", body);
    // O conteúdo é o relatório (não a tela de login): lê o texto do PDF com o pdftotext (poppler).
    const texto = execSync("pdftotext e2e/shots/relatorios-pdf/periodo.pdf -").toString();
    expect(texto).toContain("Os números do período");
    expect(texto).toContain("Do primeiro contato à venda");
    expect(texto).not.toContain("Senha");
    const eq = await page.request.get("/api/relatorios/pdf?tipo=equipe&periodo=mes", { timeout: 120_000 });
    expect(eq.status()).toBe(200);
    writeFileSync("e2e/shots/relatorios-pdf/equipe.pdf", await eq.body());
    expect(execSync("pdftotext e2e/shots/relatorios-pdf/equipe.pdf -").toString()).toContain("Por atendente");

    // pela tela: o menu Baixar PDF
    await page.goto("/relatorios?periodo=mes");
    await page.getByRole("button", { name: /Baixar PDF/ }).click();
    const download = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByRole("menuitem", { name: /Relatório do período/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^casa-fiaes-relatorio-mes-\d{4}-\d{2}-\d{2}\.pdf$/);

    await e2eSql("update users set profile_id = (select id from profiles where key = 'recepcao') where email = $1", [ANA]);
    const ctx = await browser.newContext();
    const ana = await ctx.newPage();
    try {
      await login(ana, ANA);
      expect((await ana.request.get("/api/relatorios/pdf?tipo=periodo&periodo=mes")).status()).toBe(403);
    } finally { await ctx.close(); }
  });

  test("a página de impressão não abre sem token válido (nem mostra dado)", async ({ page }) => {
    await page.goto("/imprimir/relatorio?tipo=periodo&t=inventado");
    await expect(page.getByText("Os números do período")).toHaveCount(0);
    await expect(page.getByText(/não encontrad|não existe|404/i).first()).toBeVisible();
  });
});
