import { test, expect } from "@playwright/test";
import { login, e2eSql } from "./helpers";

/** Fase C, item 25a: unir dois cadastros da mesma cliente pela ficha (⋯ › Unir com…) e a lista de possíveis duplicadas. Dados sintéticos. */
const A = "+557199978001", B = "+557199978002";
const idOf = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);

test.afterAll(async () => { await e2eSql("delete from contacts where phone_e164 in ($1, $2)", [A, B]); await e2eSql("delete from contact_merges where dropped_phone in ($1, $2)", [A, B]); });

test("unir pela ficha: um passo por tela, sem número inteiro, e a que sai some", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await e2eSql("delete from contacts where phone_e164 in ($1, $2)", [A, B]);
  await e2eSql("insert into contacts (phone_e164, name, cpf, birth_day, birth_month) values ($1, 'Zelda Duplicada E2E', '11144477735', 4, 6), ($2, 'zelda duplicada e2e', '11144477735', 4, 6)", [A, B]);
  const a = await idOf(A), b = await idOf(B);
  await login(page);
  await page.goto("/contatos?duplicadas=1");
  await expect(page.getByRole("link", { name: /Possíveis duplicadas/ })).toBeVisible();
  await expect(page.getByText("mesmo CPF").first()).toBeVisible();

  await page.goto(`/contatos/${a}`);
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Unir com/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contatos/${a}/unir`));
  await expect(page.getByRole("heading", { name: /Com quem unir/ })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\+55|1114447/);
  await page.getByRole("button", { name: /final 8002/ }).click();
  await expect(page.getByRole("heading", { name: "Qual cadastro fica?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByTestId("vai-junto")).toBeVisible();
  const unir = page.getByRole("button", { name: "Unir", exact: true });
  await expect(unir).toBeDisabled();
  await page.getByRole("checkbox", { name: /Estou ciente/ }).check();
  await unir.click();
  await expect(page).toHaveURL(/\/contatos\/[0-9a-f-]{36}$/);
  const left = await e2eSql("select count(*)::int as n from contacts where phone_e164 in ($1, $2)", [A, B]);
  expect(left[0].n).toBe(1);
  expect(a === b).toBe(false);
});
