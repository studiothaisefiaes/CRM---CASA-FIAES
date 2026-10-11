import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, shot } from "./helpers";

/** T23: etiquetas de sinal na Fila, importação com prévia e "Mídia expirada" na conversa. */
const FONE = "+5571999975";
const dealDe = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null order by d.created_at desc limit 1", [phone]))[0].id);

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+55719997501%' or phone_e164 like '+5571999975%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("delete from contacts where phone_e164 like '+5571988877%' and not exists (select 1 from deals d where d.contact_id = contacts.id)");
});

test("etiquetas de sinal aparecem na Fila e no painel da cliente", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await simulate(page, { phone: "71 99997-5001", name: "Sinal Preço", text: "Oi! Quanto custa a hidratação? Tem horário sábado?" });
  const id = await dealDe(`${FONE}001`);
  await page.goto("/atendimento");
  const item = page.locator(`[data-deal-id="${id}"]`);
  await expect(item).toBeVisible();
  await expect(item.locator("[data-signal]")).toHaveText(["Pediu preço", "Pediu horário"]);
  await shot(page, "02-fila-com-etiquetas");
  await item.click();
  await expect(page.getByTestId("sinais")).toContainText("Pediu preço");
});

test("importar CSV mostra a prévia e só grava depois de confirmar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await page.goto("/contatos");
  const csv = "nome;telefone\nAna Prévia;71 98887-7001\nAna Repetida;(71) 988877001\nSem Número;123\nBia Prévia;71 98887-7002\n";
  await page.getByRole("button", { name: "Importar clientes" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "clientes.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Ver prévia" }).click();
  const previa = page.getByTestId("import-previa");
  await expect(previa).toBeVisible();
  await expect(page.getByTestId("previa-duplicados")).toHaveText("1");
  await expect(page.getByTestId("previa-invalidos")).toHaveText("1");
  await expect(previa).toContainText("linha 4 (123)");
  expect(await e2eSql("select 1 from contacts where phone_e164 like '+5571988877%'")).toHaveLength(0);
  await shot(page, "01-previa-importacao");
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("button", { name: "Concluir" })).toBeVisible();
  expect(await e2eSql("select 1 from contacts where phone_e164 like '+5571988877%'")).toHaveLength(2);
});

test("mídia apagada pela retenção mostra 'Mídia expirada'", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await simulate(page, { phone: "71 99997-5002", name: "Foto Antiga", text: "Segue a foto" });
  const id = await dealDe(`${FONE}002`);
  await e2eSql("update messages set kind = 'image', media = '{}'::jsonb, media_purged_at = now() where contact_id = (select id from contacts where phone_e164 = $1)", [`${FONE}002`]);
  await page.goto(`/atendimento/${id}`);
  await expect(page.getByTestId("midia-expirada").first()).toContainText(/^Mídia expirada · apagada em \d{2}\/\d{2}\/\d{4}$/);
  await shot(page, "03-midia-expirada");
});
