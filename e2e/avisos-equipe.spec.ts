import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, isola } from "./helpers";

/** Lote de 16/10: não lida some ao abrir, mensagem em qualquer etapa avisa e sobe, Equipe fora da Fila de clientes, Nova conversa sem envio. */
const PREFIXO = "+5571997160";
const fone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;
const entra = (page: Parameters<typeof simulate>[0], n: number, name: string, text: string, fromMe = false) =>
  simulate(page, { phone: `71 99716-0${String(n).padStart(3, "0")}`, name, text, fromMe });

test.describe("avisos e Equipe (desktop)", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "fluxo dos 3 painéis do desktop");
    await login(page);
    await isola(PREFIXO);
  });

  test("mensagem em Agendado avisa no sino, sobe para o topo e abrir zera a não lida", async ({ page }) => {
    await entra(page, 1, "Jordana Ficticia", "Quero marcar uma escova.");
    await entra(page, 1, "", "Marcado para amanhã às 10h!", true);
    await e2eSql("update deals set stage_id = (select id from stages where key = 'agendado'), scheduled_at = now() + interval '1 day', owner_id = null where contact_id = (select id from contacts where phone_e164 = $1)", [fone(1)]);
    await entra(page, 2, "Bruna Exemplo", "Oi, quanto custa a hidratação?");
    await entra(page, 1, "Jordana Ficticia", "Posso chegar 15 min mais tarde?");
    await page.goto("/atendimento?view=todos");
    const lista = page.getByRole("listbox", { name: "Fila" });
    await expect(lista.getByRole("option").first()).toContainText("Jordana Ficticia");
    await expect(lista.getByRole("option").first().locator("[data-nao-lidas]")).toHaveText("1");
    await page.getByRole("button", { name: /Alertas/ }).first().click();
    await expect(page.getByText("Jordana Ficticia escreveu: “Posso chegar 15 min mais tarde?”")).toBeVisible();
    await page.keyboard.press("Escape");
    const abaNaoLidas = page.getByRole("navigation", { name: "Abas da fila" }).getByRole("link", { name: /^Não lidas/ });
    const antes = Number((await abaNaoLidas.innerText()).match(/\d+/)![0]);
    await lista.getByRole("option").first().locator("[data-nome]").click();
    await expect(page.getByText("Posso chegar 15 min mais tarde?").last()).toBeVisible();
    await lista.getByRole("option").filter({ hasText: "Bruna Exemplo" }).locator("[data-nome]").click();
    await expect(lista.getByRole("option").filter({ hasText: "Jordana Ficticia" }).locator("[data-nao-lidas]")).toHaveCount(0);
    await expect(abaNaoLidas).toHaveText(new RegExp(` ${antes - 2}$`), { timeout: 15_000 }); // as duas abertas saem da conta
  });

  test("Equipe: sai da Fila de clientes, avisa com aviso verde e aparece em Filtros › Equipe", async ({ page }) => {
    await entra(page, 3, "Funcionaria Teste", "Bom dia!");
    await page.goto("/atendimento?view=todos");
    await page.getByRole("listbox", { name: "Fila" }).getByRole("option").filter({ hasText: "Funcionaria Teste" }).locator("[data-nome]").click();
    await page.getByRole("button", { name: "Mais ações" }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: /Marcar como equipe/ }).click();
    await expect(page.getByText(/agora é Equipe/)).toBeVisible();
    await entra(page, 3, "Funcionaria Teste", "A chave está com quem?");
    await page.goto("/atendimento?view=todos");
    await expect(page.getByRole("listbox", { name: "Fila" }).getByRole("option").filter({ hasText: "Funcionaria Teste" })).toHaveCount(0);
    await page.getByRole("link", { name: /Equipe: 1 conversa não lida/ }).click();
    await expect(page).toHaveURL(/view=equipe/);
    const linha = page.getByRole("listbox", { name: "Fila" }).getByRole("option").filter({ hasText: "Funcionaria Teste" });
    await expect(linha).toContainText("Equipe");
    await expect(linha.locator("[data-nao-lidas]")).toBeVisible();
  });

  test("Nova conversa abre a conversa pronta para escrever e não envia nada", async ({ page }) => {
    await page.goto("/atendimento?view=todos");
    await page.getByRole("button", { name: "Nova conversa" }).filter({ visible: true }).click();
    await page.getByLabel("Telefone (WhatsApp)").fill("(71) 99716-0004");
    await page.getByLabel("Nome", { exact: true }).fill("Cliente Nova Conversa");
    await page.getByRole("button", { name: "Abrir conversa" }).click();
    await expect(page.getByPlaceholder(/Mensagem/)).toBeFocused({ timeout: 15_000 });
    await expect(page.getByText("Cliente Nova Conversa").first()).toBeVisible();
    expect(await e2eSql("select count(*)::int as n from messages m join contacts c on c.id = m.contact_id where c.phone_e164 = $1", [fone(4)])).toEqual([{ n: 0 }]);
    expect(await e2eSql("select count(*)::int as n from outbox o join deals d on d.id = o.deal_id join contacts c on c.id = d.contact_id where c.phone_e164 = $1", [fone(4)])).toEqual([{ n: 0 }]);
  });
});
