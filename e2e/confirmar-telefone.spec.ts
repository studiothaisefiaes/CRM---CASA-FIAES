import { expect, test } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Agenda › Pendências › "Confirmar por telefone" (17/10): cliente com horário amanhã e sem conversa no CRM (não recebe o lembrete)
 * aparece com o telefone para ligar e o "Iniciar conversa"; quem tem conversa não aparece. Iniciar conversa não envia nada.
 */
const OFFSET_MS = 3 * 3_600_000;
const dia = (n: number) => new Date(Date.now() - OFFSET_MS + n * 86_400_000).toISOString().slice(0, 10);
const em = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).toISOString();

async function cliente(name: string, phone: string, conversa = false) {
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [name, phone]);
  await e2eSql("delete from deals where contact_id = $1", [c.id]);
  if (conversa) await e2eSql("insert into deals (contact_id, stage_id) select $1, (select id from stages where kind = 'agendado' limit 1)", [c.id]);
  return String(c.id);
}
const horario = async (contactId: string, name: string, hm: string) => e2eSql(
  `insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key)
   values ($1, $2, (select id from professionals where name = 'Maiara'), 'Corte', $3, 60, 'agendado', 'avec', 'e2e:tel:' || gen_random_uuid())`, [contactId, name, em(dia(1), hm)]);

test.describe("Pendências › Confirmar por telefone", () => {
  test.beforeEach(async ({ page }) => {
    await e2eSql("delete from appointments where external_key like 'e2e:tel:%'");
    await login(page);
  });
  // Os horários daqui (Maiara amanhã, origem Avec) não podem ocupar a agenda dos specs seguintes (agenda-viva marca a Maiara às 11:00 amanhã).
  test.afterAll(async () => { await e2eSql("delete from appointments where external_key like 'e2e:tel:%'"); });

  test("lista quem tem horário amanhã sem conversa, com o telefone e o Iniciar conversa", async ({ page }) => {
    const semConversa = await cliente("Roger Telefone", "+5571988776601");
    const comConversa = await cliente("Rita Conversa", "+5571988776602", true);
    await horario(semConversa, "Roger Telefone", "10:00");
    await horario(comConversa, "Rita Conversa", "11:00");
    await page.goto("/agenda?aba=telefone");
    const painel = page.getByRole("dialog", { name: "Pendências da agenda" });
    await expect(painel.getByRole("button", { name: /Confirmar por telefone/ })).toBeVisible();
    await expect(painel.getByText("Roger Telefone")).toBeVisible();
    await expect(painel.getByText("Rita Conversa")).toHaveCount(0);
    await expect(painel.getByRole("link", { name: /Ligar para Roger Telefone/ })).toHaveAttribute("href", "tel:+5571988776601");
    await painel.locator("li", { hasText: "Roger Telefone" }).getByRole("button", { name: "Iniciar conversa" }).click();
    await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]+\?compose=1/, { timeout: 45_000 }); // 1ª vez: o dev server compila a conversa
    expect((await e2eSql("select count(*)::int as n from messages m join deals d on d.id = m.deal_id where d.contact_id = $1", [semConversa]))[0].n).toBe(0);
  });
});
