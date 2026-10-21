import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql } from "./helpers";

/** Trazer conversa antiga do WhatsApp (16/10): arquivo fictício, prévia, importar, selo na conversa, nada enviado; reimportar pela ficha não duplica. */
const FONE = "+5571999976001";
const ARQ = "Conversa do WhatsApp com +55 71 99997-6001.txt";
const CHAT = [
  "02/03/2025 09:00 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.",
  "02/03/2025 09:01 - Zap Antiga: Oi! Quanto custa a progressiva?",
  "02/03/2025 09:05 - Casa Fiaes: Bom dia! Sai R$ 300.",
  "03/03/2025 18:20 - Zap Antiga: Obrigada, vou pensar",
  "e te aviso 😊",
].join("\n");
const arquivo = { name: ARQ, mimeType: "text/plain", buffer: Buffer.from(CHAT) };
const contar = async () => (await e2eSql("select (select count(*) from alerts)::int a, (select count(*) from outbox)::int o, (select count(*) from deals)::int d"))[0];

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 = $1)", [FONE]);
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("importa o .txt do Exportar conversa: prévia, mensagens com selo na conversa e nada enviado", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await simulate(page, { phone: "71 99997-6001", name: "Zap Antiga", text: "Oi, voltei!" });
  const [{ deal, contato }] = await e2eSql("select d.id deal, c.id contato from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null order by d.created_at desc limit 1", [FONE]);
  const antes = await contar();

  await page.goto("/config/importar-whatsapp");
  await page.getByLabel("Arquivo da conversa exportada").setInputFiles(arquivo);
  await page.getByRole("button", { name: "Ver prévia" }).click();
  const previa = page.getByRole("region", { name: "Prévia" });
  await expect(previa).toContainText("3 mensagens de 02/03/2025 a 03/03/2025");
  await expect(previa).toContainText("3 novas");
  await expect(page.getByTestId("zap-cliente")).toContainText("Zap Antiga");
  await expect(previa.getByRole("radio", { name: /Casa Fiaes/ })).toBeChecked();
  await previa.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importado:" })).toContainText("Importado: 3 mensagens");
  await expect(page.getByRole("link", { name: "Abrir a conversa" })).toHaveAttribute("href", `/contatos/${contato}?aba=conversas`);

  expect(await contar()).toEqual(antes); // nenhum aviso, envio ou lead novo
  await page.goto(`/atendimento/${deal}`);
  const log = page.getByRole("log", { name: "Mensagens" }).first();
  await expect(log.getByTestId("historico-importado")).toHaveText(/Histórico importado do WhatsApp em \d{2}\/\d{2}/);
  await expect(log.locator("[data-importada]")).toHaveCount(3);
  await expect(log).toContainText("Obrigada, vou pensar\ne te aviso 😊");
  await expect(log).toContainText("Oi, voltei!");
});

test("pela ficha (⋯ › Trazer conversa antiga): reimportar o mesmo arquivo não duplica", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [{ contato }] = await e2eSql("select id contato from contacts where phone_e164 = $1", [FONE]);
  await page.goto(`/contatos/${contato}`);
  await page.getByRole("button", { name: "Mais ações" }).first().click();
  await page.getByRole("menuitem", { name: /Trazer conversa antiga do WhatsApp/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contatos/${contato}/trazer-conversa`));
  await page.getByLabel("Arquivo da conversa exportada").setInputFiles(arquivo);
  await page.getByRole("button", { name: "Ver prévia" }).click();
  const previa = page.getByRole("region", { name: "Prévia" });
  await expect(previa).toContainText("0 novas · 3 já estão na conversa");
  await expect(previa).toContainText("desta ficha");
  await expect(previa.getByRole("button", { name: "Importar" })).toBeDisabled();
  expect((await e2eSql("select count(*)::int n from messages where contact_id = $1 and imported_at is not null", [contato]))[0].n).toBe(3);
});
