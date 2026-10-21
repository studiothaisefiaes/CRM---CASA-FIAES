import { expect, test } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Lote 6A (base da agenda), nos projetos desktop e celular: horário de trabalho da profissional, Bloquear na Agenda e Procurar horário
 * com Copiar opções. O e2e/reset.ts deixa a agenda em modo dupla, o Corte com 60 min, a Maiara (9h–18h todo dia, faz Corte) e a Bia
 * (segue o horário da Casa, que no e2e é 24 h).
 */

const OFFSET_MS = 3 * 3_600_000; // Salvador
const amanha = () => new Date(Date.now() - OFFSET_MS + 86_400_000).toISOString().slice(0, 10);

test.describe("Lote 6A: base da agenda", () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test("Configurações › Profissionais: horário próprio e 'Igual ao da Casa'", async ({ page }) => {
    await e2eSql("update professionals set work_hours = null where name = 'Bia'");
    await page.goto("/config/profissionais");
    await page.getByRole("link", { name: "Abrir Bia" }).click();
    const sheet = page.getByRole("region", { name: "Ficha de Bia" });
    await expect(sheet.getByText("Segue o horário da Casa: seg–dom, 0h–24h")).toBeVisible();
    await sheet.getByRole("button", { name: "Definir horário próprio" }).click();
    await sheet.getByRole("switch", { name: "Segunda: trabalha" }).click(); // folga na segunda
    await sheet.getByLabel("Terça, das").selectOption("10:00");
    await sheet.getByLabel("Terça, às").selectOption("16:00");
    await sheet.getByRole("button", { name: "Salvar horário" }).click();
    await expect(page.getByText("Horário salvo")).toBeVisible();
    await expect.poll(async () => (await e2eSql("select work_hours from professionals where name = 'Bia'"))[0].work_hours)
      .toMatchObject({ "1": null, "2": [["10:00", "16:00"]] });
    await sheet.getByRole("button", { name: "Igual ao da Casa" }).click();
    await expect(page.getByText("Bia segue o horário da Casa")).toBeVisible();
    await expect(sheet.getByText("Segue o horário da Casa: seg–dom, 0h–24h")).toBeVisible();
    await expect.poll(async () => (await e2eSql("select work_hours from professionals where name = 'Bia'"))[0].work_hours).toBeNull();
  });

  test("Configurações › Profissionais: 'Assistente de' (17/10) aparece na lista para a equipe e pode ser desfeito", async ({ page }) => {
    await e2eSql("update professionals set assistant_of = null");
    try {
      await page.goto("/config/profissionais");
      await page.getByRole("link", { name: "Abrir Carla" }).click();
      const sheet = page.getByRole("region", { name: "Ficha de Carla" });
      await sheet.getByLabel("Assistente de").selectOption({ label: "Maiara" });
      await sheet.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect(page.getByText("Dados salvos")).toBeVisible();
      expect((await e2eSql("select p.name from professionals c join professionals p on p.id = c.assistant_of where c.name = 'Carla'"))[0]?.name).toBe("Maiara");
      await page.goto("/config/profissionais"); // no celular a lista fica fora da ficha
      await expect(page.getByRole("link", { name: "Abrir Carla" })).toContainText("assistente de Maiara");
      await page.getByRole("link", { name: "Abrir Carla" }).click();
      await sheet.getByLabel("Assistente de").selectOption({ label: "Ninguém: atende em nome próprio" });
      await sheet.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect.poll(async () => (await e2eSql("select assistant_of from professionals where name = 'Carla'"))[0].assistant_of).toBeNull();
    } finally {
      await e2eSql("update professionals set assistant_of = null");
    }
  });

  test("Agenda › Bloquear: aparece listrado na coluna e some ao apagar (fica só marcado no banco)", async ({ page }) => {
    await e2eSql("delete from agenda_blocks");
    await page.goto(`/agenda?v=profissionais&d=${amanha()}`);
    await page.getByRole("button", { name: "Mais ações da agenda" }).click();
    await page.getByRole("menuitem", { name: "Bloquear horário" }).click();
    const sheet = page.getByRole("dialog", { name: "Bloquear horário" });
    await expect(sheet.getByText("Enquanto o Avec estiver ligado, faça também no Avec.")).toBeVisible();
    await sheet.getByLabel("Quem").selectOption({ label: "Maiara" });
    await sheet.getByLabel("Das").selectOption("12:00");
    await sheet.getByLabel("Às").selectOption("13:00");
    await sheet.getByRole("radio", { name: "Almoço" }).click();
    await sheet.getByRole("button", { name: "Salvar bloqueio" }).click();
    await expect(page.getByText("Horário bloqueado")).toBeVisible();
    const bloco = page.getByRole("button", { name: "Bloqueado: Almoço, 12:00–13:00" });
    await expect(bloco).toBeVisible();
    await bloco.click();
    const edit = page.getByRole("dialog", { name: "Editar bloqueio" });
    await edit.getByRole("button", { name: "Apagar bloqueio" }).click();
    await edit.getByRole("button", { name: "Sim, apagar" }).click();
    await expect(page.getByText("Bloqueio apagado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Bloqueado: Almoço, 12:00–13:00" })).toHaveCount(0);
    expect(await e2eSql("select origin, deleted_at is not null as apagado from agenda_blocks where title = 'Almoço'")).toEqual([{ origin: "crm", apagado: true }]);
  });

  test("Procurar horário → Copiar opções põe o texto na área de transferência", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "permissão de área de transferência só no Chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/agenda");
    await page.getByRole("button", { name: "Mais ações da agenda" }).click();
    await page.getByRole("menuitem", { name: "Procurar horário" }).click();
    const sheet = page.getByRole("dialog", { name: "Procurar horário" });
    await sheet.getByLabel("Serviço").selectOption({ label: "Corte" });
    await sheet.getByRole("button", { name: "Procurar", exact: true }).click();
    await expect(sheet.getByRole("button", { name: /com (Maiara|Carla|Bia)$/, pressed: true }).first()).toBeVisible(); // a 1ª opção depende da hora em que roda
    await sheet.getByRole("button", { name: "Copiar opções" }).click();
    await expect(page.getByText("Opções copiadas: cole na conversa")).toBeVisible();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toMatch(/^Tenho (domingo|segunda|terça|quarta|quinta|sexta|sábado), \d{2}\/\d{2}, às \d{1,2}h(\d{2})? .*com a (Maiara|Carla|Bia)$/); // 6B: Carla e Bia também fazem Corte (e2e/seed-agenda.ts)
  });
});
