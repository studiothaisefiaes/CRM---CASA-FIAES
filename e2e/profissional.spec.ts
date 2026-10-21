import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { e2eSql, login } from "./helpers";

const MAIARA = "maiara@e2e.local";
const PREFIXO = "+557199777";
const DAY = 86_400_000;
const bahiaDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
/** Um horário de hoje que começou há 5 min (perto da meia-noite, 00:01 de hoje: nunca vira ontem). */
const startedToday = () => new Date(Math.max(Date.now() - 5 * 60_000, Date.parse(`${bahiaDay(Date.now())}T00:01:00-03:00`)));

test.describe("app da profissional (Lote 7A)", () => {
  test.skip(({ isMobile }) => !isMobile, "o app é do celular; a gestão abre o computador dentro do teste");
  let mine = "";

  test.beforeAll(async () => {
    await e2eSql(`insert into settings (key, value) values ('agenda_modo', '"dupla"'::jsonb) on conflict (key) do update set value = excluded.value`);
    const [pro] = await e2eSql("select id from professionals where lower(name) = 'maiara'");
    const [bia] = await e2eSql("insert into professionals (name) values ('Outra Prof E2E') returning id");
    const [c1] = await e2eSql("insert into contacts (name, phone_e164) values ('Paula Profissional', $1) on conflict (phone_e164) do update set name = excluded.name returning id", [`${PREFIXO}0001`]);
    const [c2] = await e2eSql("insert into contacts (name, phone_e164) values ('Outra Cliente', $1) on conflict (phone_e164) do update set name = excluded.name returning id", [`${PREFIXO}0002`]);
    await e2eSql("update appointments set status = 'cancelado' where external_key like 'e2e:pro:%'");
    const at = startedToday().toISOString();
    [{ id: mine }] = await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key)
      values ($1, 'Paula Profissional', $2, 'Corte E2E', $3, 60, 'agendado', 'crm', 'e2e:pro:' || gen_random_uuid()) returning id`, [c1.id, pro.id, at]) as { id: string }[];
    await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key)
      values ($1, 'Outra Cliente', $2, 'Escova E2E', $3, 60, 'agendado', 'crm', 'e2e:pro:' || gen_random_uuid())`, [c2.id, bia.id, at]);
  });

  // Os horários do spec saem da agenda no fim (a Maiara ocupada agora mudaria as sugestões dos specs da Agenda).
  test.afterAll(async () => { await e2eSql("update appointments set status = 'cancelado' where external_key like 'e2e:pro:%'"); });

  test("entra e cai em /pro; o Hoje mostra só os horários dela", async ({ page }) => {
    await login(page, MAIARA);
    await expect(page).toHaveURL(/\/pro$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Maiara");
    await expect(page.getByText("Paula Profissional").first()).toBeVisible();
    await expect(page.getByText("Outra Cliente")).toHaveCount(0);
  });

  test("Chegou → Iniciar → Finalizar", async ({ page }) => {
    await login(page, MAIARA);
    await page.goto(`/pro/horario/${mine}`);
    const card = page.getByRole("region", { name: "Horário" });
    await page.getByRole("button", { name: "Chegou" }).click();
    await expect(card).toContainText("Chegou");
    await page.getByRole("button", { name: "Iniciar" }).click();
    await expect(card).toContainText("Em atendimento");
    await page.getByRole("button", { name: "Finalizar" }).click();
    await expect(card).toContainText("Finalizado");
    expect((await e2eSql("select status from appointments where id = $1", [mine]))[0].status).toBe("compareceu");
  });

  test("Vi minha agenda de amanhã", async ({ page }) => {
    await login(page, MAIARA);
    await page.goto(`/pro/dia/${bahiaDay(Date.now() + DAY)}`);
    await page.getByRole("button", { name: "Vi minha agenda de amanhã" }).click();
    await expect(page.getByText(/Você viu a agenda de amanhã às \d{2}:\d{2}/)).toBeVisible();
  });

  test("pede folga e a gestão aprova no computador", async ({ page, browser }) => {
    await login(page, MAIARA);
    await page.goto("/pro/folga");
    const dia = bahiaDay(Date.now() + 5 * DAY);
    await page.getByLabel("Dia", { exact: true }).fill(dia);
    await page.getByLabel("Até").fill(dia);
    await page.getByRole("button", { name: "Pedir" }).click();
    await expect(page.getByText("Aguardando a recepção").first()).toBeVisible();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Bahia" });
    const gestao = await ctx.newPage();
    try {
      await login(gestao, "gestao@e2e.local");
      await gestao.goto("/agenda?pedidos=folga");
      const sheet = gestao.getByRole("dialog", { name: "Pedidos de folga" });
      await expect(sheet.getByText("Maiara · Folga").first()).toBeVisible();
      await sheet.getByRole("button", { name: "Aprovar" }).first().click();
      await expect(gestao.getByText(/^Aprovado/)).toBeVisible();
    } finally { await ctx.close(); }
    await page.reload();
    await expect(page.getByText("Aprovada").first()).toBeVisible();
  });

  test("telas da equipe e mídia barradas no servidor", async ({ page }) => {
    await login(page, MAIARA);
    for (const path of ["/atendimento", "/contatos", "/funil", "/config/profissionais", "/agenda"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/pro(\?|$)/);
    }
    expect((await page.request.get("/api/media/00000000-0000-4000-8000-000000000000")).status()).toBe(403);
    expect((await page.request.get("/api/relatorios/numeros?periodo=mes")).status()).toBe(403);
  });

  test("axe sem violações graves nas telas do app", async ({ page }) => {
    await login(page, MAIARA);
    for (const path of ["/pro", `/pro/dia/${bahiaDay(Date.now() + DAY)}`, "/pro/semana", "/pro/folga", "/pro/avisos", "/pro/instalar", `/pro/horario/${mine}`]) {
      await page.goto(path, { waitUntil: "load" });
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForTimeout(800); // fim das animações de entrada
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id), path).toEqual([]);
    }
  });
});
