import { expect, test } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Várias pessoas no mesmo número (17/10, caso Cati: mãe e filha no mesmo celular, as duas agendadas). Na ficha da mãe, "+ Adicionar pessoa"
 * cria a filha; no Marcar horário, a busca pelo telefone traz o número e "Para quem é o horário?" escolhe a filha; o cartão mostra o nome dela.
 */
const OFFSET_MS = 3 * 3_600_000; // Salvador
const dia = (n: number) => new Date(Date.now() - OFFSET_MS + n * 86_400_000).toISOString().slice(0, 10);
const FONE = "+5571988772001";

test.beforeEach(async ({ page }) => {
  await e2eSql("delete from appointments where contact_id in (select id from contacts where phone_e164 = $1 or shares_phone_with in (select id from contacts where phone_e164 = $1))", [FONE]);
  await e2eSql("delete from visits where contact_id in (select id from contacts where phone_e164 = $1 or shares_phone_with in (select id from contacts where phone_e164 = $1))", [FONE]);
  await e2eSql("delete from contacts where shares_phone_with in (select id from contacts where phone_e164 = $1)", [FONE]);
  await e2eSql("delete from appointments where origin = 'crm' and starts_at::date = $1::date", [dia(1)]);
  await login(page);
});

test("adiciona a filha na ficha da mãe e marca o horário para ela; o cartão mostra o nome da filha", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const [mae] = await e2eSql("insert into contacts (name, phone_e164) values ('Marta Mesmo Número', $1) on conflict (phone_e164) do update set name = excluded.name returning id", [FONE]);

  await page.goto(`/contatos/${mae.id}`);
  const bloco = page.getByTestId("pessoas-numero");
  await bloco.getByRole("button", { name: /Adicionar (outra )?pessoa/ }).click();
  const dlg = page.getByRole("dialog", { name: "Adicionar pessoa neste número" });
  await dlg.getByLabel("Nome").fill("Bruna Mesmo Número");
  await dlg.getByLabel("Quem ela é (opcional)").fill("filha");
  await dlg.getByRole("button", { name: "Adicionar" }).click();
  await expect(dlg).toBeHidden();
  await expect(bloco.getByRole("link", { name: "Bruna Mesmo Número" })).toBeVisible();
  await expect(bloco).toContainText("titular, a conversa é dela");
  const [filha] = await e2eSql("select id, phone_e164, phone_relation from contacts where shares_phone_with = $1", [mae.id]);
  expect(filha).toMatchObject({ phone_relation: "filha" });
  expect(String(filha.phone_e164)).toMatch(/^pessoa:/);

  // A ficha dela: o número é o da mãe.
  await bloco.getByRole("link", { name: "Bruna Mesmo Número" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bruna Mesmo Número");
  await expect(page.getByRole("complementary", { name: "Cliente" })).toContainText("número de Marta Mesmo Número (ela é filha)");

  // Marcar horário: a busca pelo telefone traz as duas; escolhe a mãe e troca para a filha em "Para quem é o horário?".
  await page.goto(`/agenda?d=${dia(1)}`);
  await page.getByRole("button", { name: "Marcar com Maiara às 10:00" }).click();
  const marcar = page.getByRole("dialog", { name: "Marcar horário" });
  await marcar.getByLabel("Buscar cliente por nome ou telefone").fill("88772001");
  const achadas = marcar.getByRole("list", { name: "Clientes encontradas" });
  await expect(achadas.getByRole("button")).toHaveCount(2);
  await expect(achadas.getByRole("button", { name: /Bruna Mesmo Número/ })).toContainText("usa o número de Marta Mesmo Número (filha)");
  await achadas.getByRole("button", { name: /^Marta Mesmo Número/ }).click();
  const para = marcar.getByRole("radiogroup", { name: "Para quem é o horário?" });
  await para.getByRole("radio", { name: /Bruna Mesmo Número/ }).click();
  await expect(marcar.getByTestId("cliente-escolhida")).toHaveText("Bruna Mesmo Número");
  await marcar.getByLabel("Serviço 1").selectOption({ label: "Corte" });
  await expect(marcar.getByTestId("booking-preview")).toHaveText("Livre");
  await marcar.getByRole("radio", { name: "Ela quer a Maiara" }).click();
  await marcar.getByRole("button", { name: "Marcar", exact: true }).click();
  await expect(page.getByText(/Horário marcado: Bruna/)).toBeVisible();
  await expect(page.getByRole("button", { name: /10:00 – 11:00, Bruna Mesmo Número, Corte/ })).toBeVisible();
  const [a] = await e2eSql("select contact_id from appointments where origin = 'crm' and contact_id in ($1, $2)", [mae.id, filha.id]);
  expect(a.contact_id).toBe(filha.id);
});
