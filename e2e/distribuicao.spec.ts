import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, simulate, ageLead, e2eSql } from "./helpers";

// Distribuição automática: ligar, a Ana fica disponível ao abrir o CRM, conversa cai com ela; pausa; oferta e Assumir.
const ANA = "ana@e2e.local";
const desliga = async () => {
  await e2eSql("delete from settings where key = 'distribuicao'");
  await e2eSql("update users set availability = 'ausente', last_seen_at = null");
};
const dono = async (phone: string) => (await e2eSql(
  "select u.email from deals d join contacts c on c.id = d.contact_id left join users u on u.id = d.owner_id where c.phone_e164 = $1 and d.closed_at is null and d.archived_at is null",
  [phone]))[0]?.email ?? null;

async function semViolacoes(page: Page, rotulo: string) {
  await page.waitForTimeout(800);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id), rotulo).toEqual([]);
}

test.describe("distribuição automática", () => {
  test.skip(({ isMobile }) => isMobile, "desktop");
  test.beforeEach(desliga);
  test.afterEach(desliga);

  test("ligar, a Ana fica disponível ao abrir o CRM e a conversa nova cai com ela; em pausa, não", async ({ page, browser }) => {
    await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
    await login(page);
    await page.goto("/config/distribuicao");
    await page.getByRole("switch", { name: "Distribuição automática" }).click();
    await page.getByRole("button", { name: "Ligar" }).click();
    await expect(page.getByText("Distribuição ligada")).toBeVisible();
    await semViolacoes(page, "config distribuição");

    const ctx = await browser.newContext();
    const ana = await ctx.newPage();
    try {
      await login(ana, ANA);
      await ana.goto("/atendimento"); // CRM aberto: a batida deixa a Ana disponível
      await expect.poll(async () => (await e2eSql("select availability from users where email = $1", [ANA]))[0].availability).toBe("disponivel");
      await expect(ana.getByRole("button", { name: /Meu estado: Disponível/ })).toBeVisible();

      await simulate(page, { phone: "71 99701-0101", name: "Dina Distribuída", text: "Oi, queria marcar" });
      expect(await dono("+5571997010101")).toBe(ANA);

      await ana.getByRole("button", { name: /Meu estado/ }).click();
      await ana.getByRole("menuitem", { name: "Em pausa" }).click();
      await expect(ana.getByText(/Em pausa/).first()).toBeVisible();
      await simulate(page, { phone: "71 99701-0102", name: "Paula Pausa", text: "Oi" });
      expect(await dono("+5571997010102")).toBeNull();
      // a Dina (sem resposta) voltou para a fila quando a Ana entrou em pausa
      expect(await dono("+5571997010101")).toBeNull();
    } finally { await ctx.close(); }
  });

  test("prazo estourado: a próxima pessoa livre recebe a oferta, clica em Assumir e vira a dona; a Ana é avisada", async ({ page }) => {
    await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
    await e2eSql("insert into settings (key, value) values ('distribuicao', '{\"enabled\": true, \"limit\": 5}') on conflict (key) do update set value = excluded.value");
    // a gestão entra no rodízio só para este teste (perfil Gestão: a caixinha é opcional)
    await e2eSql("update profiles set permissions = array_append(permissions, 'distribuicao.receber') where key = 'gestao' and not permissions @> array['distribuicao.receber']");
    try {
      await login(page);
      await simulate(page, { phone: "71 99701-0201", name: "Olga Oferta", text: "Tem horário hoje?" });
      await e2eSql("update deals set owner_id = (select id from users where email = $1) where contact_id = (select id from contacts where phone_e164 = '+5571997010201')", [ANA]);
      await page.goto("/atendimento"); // gestão com o CRM aberto: disponível
      await expect.poll(async () => (await e2eSql("select availability from users where email = 'gestao@e2e.local'"))[0].availability).toBe("disponivel");
      // o tempo passa também para o histórico do lead (a entrega na chegada não pode parecer "agora")
      await e2eSql("update deal_events set created_at = created_at - interval '12 minutes' where deal_id = (select id from deals where contact_id = (select id from contacts where phone_e164 = '+5571997010201'))");
      ageLead("+5571997010201", 12); // motor cria o atraso; em seguida, a oferta
      await page.goto("/?vista=resumo");
      const bell = page.getByRole("button", { name: /Alertas/ }).first();
      await bell.click();
      const oferta = page.getByRole("dialog", { name: "Alertas" }).getByRole("listitem").filter({ hasText: "A dona não respondeu. Pode assumir Olga Oferta?" });
      await expect(oferta).toBeVisible();
      await oferta.getByRole("button", { name: "Assumir", exact: true }).click(); // exato: o "Resolver: … Pode assumir …" também contém a palavra
      await expect(page).toHaveURL(/\/atendimento/);
      expect(await dono("+5571997010201")).toBe("gestao@e2e.local");
      const [aviso] = await e2eSql("select message from alerts a join users u on u.id = a.user_id where u.email = $1 and a.type = 'assumiu_sua_conversa' order by a.created_at desc limit 1", [ANA]);
      expect(aviso.message).toBe("Thaíse assumiu a conversa de Olga Oferta");
    } finally {
      await e2eSql("update profiles set permissions = array_remove(permissions, 'distribuicao.receber') where key = 'gestao'");
    }
  });
});
