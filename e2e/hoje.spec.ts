import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

/** T20: o Hoje. Resumo do dia (gestão), próximas ações e comparecimento (atendente), contador de atrasados que leva à Fila. */

const PREFIXO = "+5571997950";
const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bahia" }); // AAAA-MM-DD em Salvador
let corrida = 0; // um telefone novo a cada teste (o desktop e o celular rodam o mesmo arquivo no mesmo banco)
const em = (hhmm: string) => `${dia}T${hhmm}:00-03:00`;
const ontem = (hhmm: string) => new Date(Date.parse(em(hhmm)) - 86_400_000);

async function isola() {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  // Só os leads abertos saem de cena: as vendas do dia continuam nos números dos relatórios (o spec de relatórios depende delas).
  await e2eSql("update deals set archived_at = now() where archived_at is null and closed_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${PREFIXO}%`]);
  await e2eSql("update tasks set done_at = now() where done_at is null");
}
const usuario = async (email: string) => String((await e2eSql("select id from users where email = $1", [email]))[0].id);

/** Um lead Agendado cujo horário já passou, sem comparecimento marcado. */
async function agendado(n: number, nome: string, scheduledAt: Date, ownerEmail: string | null = null) {
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) returning id", [nome, `${PREFIXO}${n}${Date.now() % 100000}${++corrida}`]);
  const [d] = await e2eSql(
    "insert into deals (contact_id, stage_id, owner_id, scheduled_at) values ($1, (select id from stages where kind = 'agendado' limit 1), $2, $3) returning id",
    [c.id, ownerEmail ? await usuario(ownerEmail) : null, scheduledAt]);
  return { contactId: String(c.id), dealId: String(d.id) };
}
async function tarefa(c: { contactId: string; dealId: string }, title: string, dueAt: Date, assigneeEmail: string, kind = "proxima_acao") {
  const [t] = await e2eSql("insert into tasks (contact_id, deal_id, kind, title, due_at, assignee_id) values ($1, $2, $3, $4, $5, $6) returning id",
    [c.contactId, c.dealId, kind, title, dueAt, await usuario(assigneeEmail)]);
  return String(t.id);
}
const semPortal = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

test.beforeEach(async () => { await isola(); });
test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like $1)", [`${PREFIXO}%`]);
  await e2eSql("update tasks set done_at = coalesce(done_at, now()) where contact_id in (select id from contacts where phone_e164 like $1)", [`${PREFIXO}%`]);
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("gestão: o resumo fica recolhido até as 19h e abre em destaque depois", async ({ page, isMobile }) => {
  await login(page);
  await semPortal(page);
  const topo = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;

  await page.goto(`/?agora=${encodeURIComponent(em("10:00"))}`);
  await semPortal(page);
  const resumo = page.getByTestId("resumo-do-dia");
  await expect(resumo).toHaveAttribute("data-destaque", "nao");
  await expect(resumo.getByText("Resumo até agora")).toBeVisible();
  await expect(resumo.getByRole("button", { name: "Copiar texto" })).toBeHidden(); // recolhido
  await expect(page.getByRole("heading", { name: "Minhas próximas ações" })).toBeVisible();
  await page.waitForTimeout(700);
  expect(await topo("resumo-do-dia")).toBeGreaterThan(await topo("hero-esperando")); // o que pede ação vem antes
  await shot(page, `gestao-antes-das-19h${isMobile ? "-390" : ""}`, { fullPage: !isMobile }); // no celular o recorte é a tela (a barra inferior é fixa e atravessaria a página inteira)
  await resumo.getByText("Resumo até agora").click();
  await expect(resumo.getByRole("button", { name: "Copiar texto" })).toBeVisible();
  await expect(resumo.getByText(/^Resumo de hoje/)).toBeVisible();

  await page.goto(`/?agora=${encodeURIComponent(em("20:00"))}`);
  await semPortal(page);
  await expect(resumo).toHaveAttribute("data-destaque", "sim");
  await expect(resumo.getByText("Resumo do dia")).toBeVisible();
  await expect(resumo.getByRole("button", { name: "Copiar texto" })).toBeVisible(); // aberto
  await page.waitForTimeout(700);
  expect(await topo("resumo-do-dia")).toBeLessThan(await topo("hero-esperando")); // das 19h em diante, o resumo abre o dia
  await shot(page, `gestao-depois-das-19h${isMobile ? "-390" : ""}`, { fullPage: !isMobile });
});

test("o contador de atrasados é um link para a Fila filtrada, com o mesmo número do sino e do título", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99795-0901", name: "Paula Atrasada", text: "Oi, quero horário." });
  ageLead("+5571997950901", 11);
  await page.goto("/");
  const link = page.getByRole("link", { name: /1 atrasado · ver na fila/ });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page).toHaveTitle(/\(1\) atrasados/);
  await link.click();
  await expect(page).toHaveURL(/\/atendimento\?foco=atrasados/);
  await expect(page.getByRole("option", { name: /Paula Atrasada/ })).toBeVisible();
});

test("gestão: Compareceu e Faltou tiram o item da lista, com aviso do resultado", async ({ page }) => {
  const a = await agendado(1, "Bianca Conferida", ontem("15:00"));
  const b = await agendado(2, "Carla Faltosa", ontem("16:00"));
  await login(page);
  await page.goto("/");
  const secao = page.getByRole("region", { name: "Comparecimentos de ontem" });
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(2);
  await expect(secao).toContainText("ontem 15:00");

  await secao.getByRole("button", { name: "Compareceu: Bianca Conferida" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bianca Conferida compareceu" })).toBeVisible();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(1);
  await expect(secao.getByText("Bianca Conferida")).toHaveCount(0);
  expect((await e2eSql("select attendance from deals where id = $1", [a.dealId]))[0].attendance).toBe("compareceu");

  await secao.getByRole("button", { name: "Faltou: Carla Faltosa" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Carla Faltosa faltou · próxima ação: Remarcar" })).toBeVisible();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(0);
  await expect(secao.getByText(/Nada para conferir/)).toBeVisible();
  expect((await e2eSql("select attendance from deals where id = $1", [b.dealId]))[0].attendance).toBe("faltou");
  await page.reload();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(0); // continua fora depois de recarregar
});

test("atendente: Minhas próximas ações (vencidas primeiro, concluir com um toque) e Comparecimentos de ontem", async ({ page, isMobile }) => {
  const c = await agendado(3, "Dora Agendada", ontem("14:00"), "ana@e2e.local");
  const d = await agendado(4, "Elaine Retorno", ontem("10:00"), "ana@e2e.local");
  await e2eSql("update deals set attendance = 'compareceu' where id = $1", [d.dealId]);
  await tarefa(d, "Mandar os valores da hidratação", ontem("09:00"), "ana@e2e.local");
  await tarefa(d, "Confirmar o horário de sábado", new Date(Date.parse(em("23:59"))), "ana@e2e.local", "retorno");
  await tarefa(d, "Tarefa da gestão", ontem("09:00"), "gestao@e2e.local");
  await tarefa(d, "Amanhã não aparece", new Date(Date.parse(em("12:00")) + 86_400_000 + 3_600_000 * 12), "ana@e2e.local");
  await login(page, "ana@e2e.local");
  await expect(page.getByTestId("resumo-do-dia")).toHaveCount(0); // o resumo é da gestão

  const acoes = page.getByRole("region", { name: "Minhas próximas ações" });
  await expect(acoes).toBeVisible();
  const itens = acoes.getByTestId("proxima-acao-item");
  await expect(itens).toHaveCount(2);
  await expect(itens.nth(0)).toContainText("Mandar os valores da hidratação");
  await expect(itens.nth(0)).toContainText("atrasada ontem 09:00");
  await expect(itens.nth(1)).toContainText("Confirmar o horário de sábado");
  await expect(itens.nth(1)).not.toContainText("atrasada");
  await expect(acoes.getByText("Tarefa da gestão")).toHaveCount(0);
  expect(await itens.nth(0).getByRole("link").getAttribute("href")).toBe(`/atendimento?lead=${d.dealId}`);

  const conf = page.getByRole("region", { name: "Comparecimentos de ontem" });
  await expect(conf.getByTestId("comparecimento-item")).toHaveCount(1);
  await expect(conf).toContainText("Dora Agendada");
  await semPortal(page);
  await shot(page, `atendente${isMobile ? "-390" : ""}`, { fullPage: !isMobile });
  if (isMobile) {
    await acoes.scrollIntoViewIfNeeded();
    await acoes.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await shot(page, "atendente-390-acoes-e-comparecimentos");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const botao of [acoes.getByRole("button", { name: /Concluir: Mandar/ }), conf.getByRole("button", { name: "Compareceu: Dora Agendada" }), conf.getByRole("button", { name: "Faltou: Dora Agendada" })]) {
      expect((await botao.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }

  await acoes.getByRole("button", { name: "Concluir: Mandar os valores da hidratação" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Concluída: Mandar os valores da hidratação" })).toBeVisible();
  await expect(itens).toHaveCount(1);
  await expect(acoes.getByText("Mandar os valores da hidratação")).toHaveCount(0);
  expect((await e2eSql("select done_at from tasks where title = 'Mandar os valores da hidratação'"))[0].done_at).not.toBeNull();

  await conf.getByRole("button", { name: "Compareceu: Dora Agendada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dora Agendada compareceu" })).toBeVisible();
  await expect(conf.getByTestId("comparecimento-item")).toHaveCount(0);
  expect((await e2eSql("select attendance from deals where id = $1", [c.dealId]))[0].attendance).toBe("compareceu");
});
