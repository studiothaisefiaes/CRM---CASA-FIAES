import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, isola } from "./helpers";

/** 17/10: "Marcar como…" Cliente, Equipe, Fornecedor ou Spam (botão direito e toque longo na Fila). */
const PREFIXO = "+5571997170";
const fone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;
const entra = (page: Page, n: number, name: string, text: string) => simulate(page, { phone: `71 99717-0${String(n).padStart(3, "0")}`, name, text });
const linha = (page: Page, nome: string) => page.getByRole("listbox", { name: "Fila" }).getByRole("option").filter({ hasText: nome });
const contato = async (n: number) => (await e2eSql("select * from contacts where phone_e164 = $1", [fone(n)]))[0] as { id: string; kind: string; ignored: boolean };

test.beforeEach(async ({ page }) => {
  await login(page);
  await isola(PREFIXO);
});

test("botão direito na Fila: Marcar como Fornecedor tira da Fila, resolve e põe em Filtros › Fornecedores, com selo na conversa", async ({ page, isMobile }) => {
  test.skip(isMobile, "botão direito é do computador");
  await entra(page, 1, "Distribuidora Ficticia", "Segue o boleto do pedido 123");
  await page.goto("/atendimento?view=todos");
  await linha(page, "Distribuidora Ficticia").click({ button: "right" });
  const menu = page.getByRole("menu", { name: /Marcar Distribuidora Ficticia como/ });
  await expect(menu).toBeVisible();
  for (const t of ["Cliente", "Equipe", "Fornecedor", "Spam"]) await expect(menu.getByRole("menuitemradio", { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /^Cliente/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /^Fornecedor/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Distribuidora Ficticia agora é Fornecedor" })).toBeVisible();
  await expect(linha(page, "Distribuidora Ficticia")).toHaveCount(0);
  expect((await contato(1)).kind).toBe("fornecedor");
  const [d] = await e2eSql("select conversation_archived_at from deals where contact_id = $1 and archived_at is null", [(await contato(1)).id]);
  expect(d.conversation_archived_at).not.toBeNull();

  await page.goto("/atendimento?view=fornecedores");
  await linha(page, "Distribuidora Ficticia").locator("[data-nome]").click();
  await expect(page.getByTestId("tipo-contato").filter({ visible: true })).toHaveText("Fornecedor");
});

test("Spam pelo botão direito some da Fila e volta por Filtros › Spam com Marcar como cliente", async ({ page, isMobile }) => {
  test.skip(isMobile, "botão direito é do computador");
  await entra(page, 2, "Robo Operadora", "Sua fatura chegou. Responda 1 para segunda via.");
  await page.goto("/atendimento?view=todos");
  await linha(page, "Robo Operadora").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: /^Spam/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Robo Operadora agora é Spam e saiu da lista" })).toBeVisible();
  await expect(linha(page, "Robo Operadora")).toHaveCount(0);
  expect(await contato(2)).toMatchObject({ kind: "spam", ignored: true });
  await page.goto("/atendimento?view=nao-cliente");
  await linha(page, "Robo Operadora").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: /^Cliente/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Robo Operadora voltou a ser cliente" })).toBeVisible();
  expect(await contato(2)).toMatchObject({ kind: "cliente", ignored: false });
  await page.goto("/atendimento?view=todos");
  await expect(linha(page, "Robo Operadora")).toBeVisible();
});

test("celular: toque longo na linha abre o Marcar como… (sem abrir a conversa)", async ({ page, isMobile }) => {
  test.skip(!isMobile, "toque longo é do celular");
  await entra(page, 3, "Fornecedor Toque", "Pedido saiu para entrega");
  await page.goto("/atendimento?view=todos");
  const row = linha(page, "Fornecedor Toque");
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const menu = page.getByRole("menu", { name: /Marcar Fornecedor Toque como/ });
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/\/atendimento\?view=todos/); // não abriu a conversa
  await menu.getByRole("menuitemradio", { name: /^Fornecedor/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Fornecedor Toque agora é Fornecedor" })).toBeVisible();
  expect((await contato(3)).kind).toBe("fornecedor");
});

test("Resolver à vista na faixa da conversa (robô da operadora, 17/10): resolve sem abrir o status ▾", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await entra(page, 4, "Robo Claro Empresas", "Seu protocolo é 123. Avalie nosso atendimento.");
  const [{ id }] = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [fone(4)]);
  await page.goto(`/atendimento?lead=${id}`);
  const lead = page.getByRole("region", { name: /Conversa com Robo Claro Empresas/ });
  await lead.getByTestId("faixa-conversa").getByRole("button", { name: "Resolver", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Conversa com Robo Claro Empresas resolvida" })).toBeVisible();
  await expect.poll(async () => (await e2eSql("select conversation_archived_at from deals where id = $1", [id]))[0].conversation_archived_at).not.toBeNull();
});
