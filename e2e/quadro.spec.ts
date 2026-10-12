import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot, usaQuadroIsolado } from "./helpers";

const PREFIXO = "+5571997361";
const phone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;
const entra = (page: Page, n: number, name: string, text = "Oi, tudo bem?") => simulate(page, { phone: `71 99736-1${String(n).padStart(3, "0")}`, name, text });
const etapaDe = async (n: number) => (await e2eSql("select s.key from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id where c.phone_e164 = $1", [phone(n)]))[0]?.key;

const isola = usaQuadroIsolado();

const coluna = (page: Page, nome: RegExp) => page.getByRole("region", { name: nome });

/** Teclado: o dnd-kit só passa a ouvir as setas um instante depois do Espaço (uma pessoa nunca é mais rápida que isso); o teste espera esse instante. */
const pega = async (page: Page) => { await page.keyboard.press("Space"); await page.waitForTimeout(200); };
const seta = async (page: Page, tecla: "ArrowRight" | "ArrowLeft", vezes = 1) => { for (let i = 0; i < vezes; i++) { await page.keyboard.press(tecla); await page.waitForTimeout(150); } };

/** Leva o ponteiro de um card até o meio de um alvo, com passos (o dnd-kit só começa a arrastar depois de 6 px). */
async function arrasta(page: Page, de: ReturnType<Page["locator"]>, para: ReturnType<Page["locator"]>) {
  const a = (await de.boundingBox())!, b = (await para.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120), { steps: 12 });
  await page.mouse.up();
}

test.describe("Quadro", () => {
  test.beforeEach(({ isMobile }) => { test.skip(isMobile, "desktop"); });

  test("teclado: Espaço pega, setas escolhem a coluna, Espaço solta; Esc cancela; o leitor de tela ouve em português", async ({ page }) => {
    await login(page);
    await isola();
    await entra(page, 1, "Aline Prado");
    await page.goto("/funil");
    const link = coluna(page, /^Lead,/).getByRole("link", { name: /Aline Prado/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("aria-roledescription", "lead arrastável");

    // Esc cancela e o card continua onde estava
    await link.focus();
    await pega(page);
    await expect(page.getByText(/Pegou Aline Prado, da coluna Lead\./)).toBeAttached();
    await seta(page, "ArrowRight");
    await expect(page.getByText(/Aline Prado está sobre a coluna Atendimento\./)).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/Movimento cancelado\. Aline Prado continua em Lead\./)).toBeAttached();
    expect(await etapaDe(1)).toBe("lead");
    await expect(coluna(page, /^Lead,/).getByRole("link", { name: /Aline Prado/ })).toBeVisible();

    // Espaço, seta para a direita, Espaço: vai para Atendimento
    await link.focus();
    await pega(page);
    await seta(page, "ArrowRight");
    await page.keyboard.press("Space");
    await expect(page.getByText(/Aline Prado foi para Atendimento\./)).toBeAttached();
    await expect(coluna(page, /^Atendimento,/).getByRole("link", { name: /Aline Prado/ })).toBeVisible();
    await expect.poll(() => etapaDe(1)).toBe("atendimento");
    // O foco volta ao card, que mudou de coluna
    await expect(coluna(page, /^Atendimento,/).getByRole("link", { name: /Aline Prado/ })).toBeFocused();

    // Seta para a esquerda traz de volta
    await pega(page);
    await seta(page, "ArrowLeft");
    await page.keyboard.press("Space");
    await expect.poll(() => etapaDe(1)).toBe("lead");
    // Enter segue abrindo o lead (é um link)
    await coluna(page, /^Lead,/).getByRole("link", { name: /Aline Prado/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: /Lead Aline Prado/ })).toBeVisible();
  });

  test("soltar em Fechado abre a folha de venda; cancelar devolve o card; o servidor não deixa fechar sem os dados", async ({ page }) => {
    await login(page);
    await isola();
    await entra(page, 2, "Bruna Teles");
    await page.setViewportSize({ width: 1700, height: 900 }); // com 1440 px as colunas Fechado e Perdido ficam além da borda (rolagem lateral)
    await page.goto("/funil");
    const card = coluna(page, /^Lead,/).getByRole("link", { name: /Bruna Teles/ });
    await expect(card).toBeVisible();

    await arrasta(page, card, page.getByRole("button", { name: /Mostrar Fechado/ }));
    const folha = page.getByRole("dialog", { name: "Fechar venda" });
    await expect(folha).toBeVisible();
    await expect(folha.getByLabel("Valor")).toBeFocused();
    expect(await etapaDe(2)).toBe("lead"); // nada mudou ainda
    await shot(page, "quadro-folha-fechar-venda");
    await folha.getByRole("button", { name: "Cancelar" }).click();
    await expect(folha).toHaveCount(0);
    await expect(coluna(page, /^Lead,/).getByRole("link", { name: /Bruna Teles/ })).toBeVisible(); // voltou à coluna de origem
    expect(await etapaDe(2)).toBe("lead");

    // Pelo teclado também (quatro setas até Fechado, com a rolagem acompanhando) e, pela folha de venda, o card vai para Fechado
    await coluna(page, /^Lead,/).getByRole("link", { name: /Bruna Teles/ }).focus();
    await pega(page);
    await seta(page, "ArrowRight", 4);
    await page.keyboard.press("Space");
    await expect(folha).toBeVisible();
    await folha.getByLabel("Valor").fill("250");
    await folha.getByRole("radio", { name: "Pix" }).click();
    await folha.getByRole("radio", { name: "Coloração" }).click();
    await folha.getByRole("button", { name: "Fechar venda" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Venda fechada · R$ 250,00" })).toBeVisible();
    await expect.poll(() => etapaDe(2)).toBe("fechado");
    expect((await e2eSql("select value_cents from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1", [phone(2)]))[0].value_cents).toBe(25000);
  });

  test("soltar em Agendado abre a folha de agendamento", async ({ page }) => {
    await login(page);
    await isola();
    await entra(page, 3, "Carol Dias");
    await page.goto("/funil");
    await arrasta(page, coluna(page, /^Lead,/).getByRole("link", { name: /Carol Dias/ }), coluna(page, /^Agendado,/));
    const folha = page.getByRole("dialog", { name: "Agendar avaliação" });
    await expect(folha).toBeVisible();
    await folha.getByRole("button", { name: "Agendar" }).click();
    await expect(coluna(page, /^Agendado,/).getByRole("link", { name: /Carol Dias/ })).toBeVisible();
    await expect.poll(() => etapaDe(3)).toBe("agendado");
  });

  test("a coluna ordena por urgência: atrasado, perto do prazo, aguardando, e quem não espera por último", async ({ page }) => {
    await login(page);
    await isola();
    await entra(page, 10, "Dora Quieta");
    await entra(page, 11, "Eva Recente");
    await entra(page, 12, "Fabi Perto");
    await entra(page, 13, "Gabi Atrasada");
    await entra(page, 14, "Hana Atendida", "Bom dia!");
    await entra(page, 15, "Iris Agendada", "Quero marcar uma avaliação.");
    await e2eSql(`update deals set stage_id = (select id from stages where key = 'atendimento'), awaiting_reply_since = null where contact_id = (select id from contacts where phone_e164 = $1)`, [phone(14)]);
    await e2eSql(`update deals set stage_id = (select id from stages where key = 'agendado'), awaiting_reply_since = null, scheduled_at = now() + interval '1 day' where contact_id = (select id from contacts where phone_e164 = $1)`, [phone(15)]);
    await e2eSql("update deals set awaiting_reply_since = null where contact_id = (select id from contacts where phone_e164 = $1)", [phone(10)]);
    await e2eSql("update deals set awaiting_reply_since = now() - interval '15 seconds' where contact_id = (select id from contacts where phone_e164 = $1)", [phone(11)]);
    await e2eSql("update deals set awaiting_reply_since = now() - interval '75 seconds' where contact_id = (select id from contacts where phone_e164 = $1)", [phone(12)]);
    ageLead(phone(13), 11); // passa do prazo e o motor abre o alerta de espera
    await page.goto("/funil");
    const nomes = await coluna(page, /^Lead,/).getByRole("link").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const ordem = ["Gabi Atrasada", "Fabi Perto", "Eva Recente", "Dora Quieta"].map((n) => nomes.findIndex((t) => t.includes(n)));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    await expect(coluna(page, /^Lead,/)).toContainText("1 atrasado");
    await expect(coluna(page, /^Agendado,/).getByRole("link", { name: /Iris Agendada/ })).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "quadro-desktop");
  });

  test("escopo: a atendente vê os leads dela e os sem dono, não os de outra pessoa; a gestão vê todos", async ({ page }) => {
    await login(page);
    await isola();
    await entra(page, 20, "Helena Dela");
    await entra(page, 21, "Irene Semdono");
    await entra(page, 22, "Julia Dagestao");
    const dono = (n: number, email: string | null) => e2eSql(`update deals set owner_id = ${email ? "(select id from users where email = $2)" : "null"} where contact_id = (select id from contacts where phone_e164 = $1)`, email ? [phone(n), email] : [phone(n)]);
    await dono(20, "ana@e2e.local"); await dono(21, null); await dono(22, "gestao@e2e.local");
    await page.goto("/funil");
    for (const n of ["Helena Dela", "Irene Semdono", "Julia Dagestao"]) await expect(page.getByRole("link", { name: new RegExp(n) })).toBeVisible();

    await page.context().clearCookies();
    await login(page, "ana@e2e.local");
    await page.goto("/funil");
    await expect(page.getByRole("link", { name: /Helena Dela/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Irene Semdono/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Julia Dagestao/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Formas de ver os leads" }).getByRole("link", { name: "Jornada" })).toHaveCount(0); // a Jornada é só da gestão
  });

  test("id malformado nunca vira erro 500", async ({ page }) => {
    await login(page);
    const feio = "-".repeat(36);
    expect((await page.request.get(`/api/avatar/${feio}`)).status()).toBe(404);
    expect((await page.request.get(`/api/media/${feio}`)).status()).toBe(404);
    const r = await page.goto(`/funil?lead=${feio}&dono=${feio}`);
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("navigation", { name: "Formas de ver os leads" }).getByRole("link", { name: "Quadro" })).toHaveAttribute("aria-current", "page");
    expect((await page.goto(`/atendimento?dono=${feio}&filtro=atrasados&lead=${feio}`))?.status()).toBe(200);
    expect((await page.goto(`/relatorios?dono=${feio}`))?.status()).toBeLessThan(500);
  });
});
