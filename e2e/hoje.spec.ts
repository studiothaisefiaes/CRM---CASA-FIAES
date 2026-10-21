import { test, expect, type Page } from "@playwright/test";
import { login, simulate, ageLead, e2eSql, shot } from "./helpers";

/** O Hoje (v3, protótipo aprovado em 17/10): resumo da gestão, "Para você agora", blocos que abrem o painel grande e a tabela do dia. */

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
  await expect(page.getByRole("heading", { name: "Meus combinados" })).toBeVisible();
  await page.waitForTimeout(700);
  expect(await topo("resumo-do-dia")).toBeLessThan(await topo("para-voce")); // o resumo fica no topo nos dois modos (recolhido aqui)
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
  expect(await topo("resumo-do-dia")).toBeLessThan(await topo("para-voce")); // das 19h em diante, o resumo abre o dia, aberto e em destaque
  await shot(page, `gestao-depois-das-19h${isMobile ? "-390" : ""}`, { fullPage: !isMobile });
});

test("o contador de atrasados (no painel de Esperando resposta) é um link para a Fila filtrada, com o mesmo número do sino e do título", async ({ page }) => {
  await login(page);
  await simulate(page, { phone: "71 99795-0901", name: "Paula Atrasada", text: "Oi, quero horário." });
  ageLead("+5571997950901", 11);
  await page.goto("/");
  const bloco = page.getByRole("region", { name: "Esperando resposta" });
  await expect(bloco).toContainText("1 atrasado");
  await expect(page).toHaveTitle(/\(1\) atrasados/);
  await bloco.getByRole("button", { name: "Abrir as conversas: Esperando resposta" }).click();
  const painel = page.getByRole("dialog", { name: "Esperando resposta" });
  const link = painel.getByRole("link", { name: /1 atrasado · ver na fila/ });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const vermelhas = painel.locator('[data-late="sim"]');
  await expect(vermelhas).toHaveCount(1); // as linhas vermelhas são as do contador
  await expect(vermelhas).toContainText("Paula Atrasada");
  await expect(vermelhas).toContainText(/Passou \d+ min do prazo/); // o texto único do prazo (slaText), o mesmo da Fila
  await link.click();
  await expect(page).toHaveURL(/\/atendimento\?foco=atrasados/);
  await expect(page.getByRole("option", { name: /Paula Atrasada/ })).toBeVisible();
});

test("gestão: comparecimentos ficam no painel de Meus combinados; Compareceu e Faltou tiram o item da lista, com aviso do resultado", async ({ page }) => {
  const a = await agendado(1, "Bianca Conferida", ontem("15:00"));
  const b = await agendado(2, "Carla Faltosa", ontem("16:00"));
  await login(page);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Meus combinados" })).toContainText("Comparecimentos para conferir");
  await page.getByRole("button", { name: "Ver todos: Meus combinados" }).click();
  const secao = page.getByRole("dialog", { name: "Meus combinados" }).getByRole("region", { name: "Comparecimentos para conferir" });
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(2);
  await expect(secao).toContainText("ontem 15:00");

  await secao.getByRole("button", { name: "Veio: Bianca Conferida" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bianca Conferida veio" })).toBeVisible();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(1);
  expect((await e2eSql("select attendance from deals where id = $1", [a.dealId]))[0].attendance).toBe("compareceu");

  // QA r58 (M-2): Faltou pede confirmação (Voltar não marca) e o aviso tem Desfazer, que devolve a conversa como estava.
  await secao.getByRole("button", { name: "Faltou: Carla Faltosa" }).click();
  await page.getByRole("dialog", { name: "O que aconteceu?" }).getByRole("button", { name: "Voltar" }).click();
  expect((await e2eSql("select attendance from deals where id = $1", [b.dealId]))[0].attendance).not.toBe("faltou");
  await secao.getByRole("button", { name: "Faltou: Carla Faltosa" }).click();
  await page.getByRole("dialog", { name: "O que aconteceu?" }).getByRole("button", { name: "Marcar que não veio" }).click();
  await page.getByRole("status").filter({ hasText: "Carla Faltosa faltou" }).getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Desfeito: Carla Faltosa voltou para a lista" })).toBeVisible();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(1);
  expect((await e2eSql("select attendance from deals where id = $1", [b.dealId]))[0].attendance).not.toBe("faltou");
  await secao.getByRole("button", { name: "Faltou: Carla Faltosa" }).click();
  await page.getByRole("dialog", { name: "O que aconteceu?" }).getByRole("button", { name: "Marcar que não veio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Carla Faltosa faltou · combinado: Remarcar" })).toBeVisible();
  await expect(secao.getByTestId("comparecimento-item")).toHaveCount(0);
  expect((await e2eSql("select attendance from deals where id = $1", [b.dealId]))[0].attendance).toBe("faltou");
  await page.reload();
  await expect(page.getByRole("region", { name: "Meus combinados" })).not.toContainText("Comparecimentos para conferir"); // continua fora depois de recarregar
});

test("atendente: Para você agora, Meus combinados (prévia de 3, vencidas primeiro, concluir no painel) e comparecimento", async ({ page, isMobile }) => {
  const c = await agendado(3, "Dora Agendada", ontem("14:00"), "ana@e2e.local");
  const d = await agendado(4, "Elaine Retorno", ontem("10:00"), "ana@e2e.local");
  await e2eSql("update deals set attendance = 'compareceu' where id = $1", [d.dealId]);
  await tarefa(d, "Mandar os valores da hidratação", ontem("09:00"), "ana@e2e.local");
  await tarefa(d, "Confirmar o horário de sábado", new Date(Date.parse(em("23:59"))), "ana@e2e.local", "retorno");
  await tarefa(d, "Tarefa da gestão", ontem("09:00"), "gestao@e2e.local");
  await tarefa(d, "Amanhã não aparece", new Date(Date.parse(em("12:00")) + 86_400_000 + 3_600_000 * 12), "ana@e2e.local");
  await tarefa(d, "Responder +557190000002", ontem("08:00"), "ana@e2e.local");
  await login(page, "ana@e2e.local");
  await expect(page.getByTestId("resumo-do-dia")).toHaveCount(0); // o resumo é da gestão
  await expect(page.getByTestId("para-voce")).toContainText("3 combinados para hoje");

  const acoes = page.getByRole("region", { name: "Meus combinados" });
  await expect(acoes.getByTestId("previa-linha").first()).toContainText("Responder cliente com final 5353"); // nunca o telefone cru (o número não é o da Elaine: não ganha o nome dela)
  await expect(acoes).not.toContainText("+557190000002");
  await expect(acoes).toContainText("Mandar os valores da hidratação");
  await expect(acoes).toContainText("ontem 09:00 · atrasado");
  await expect(acoes).toContainText("Comparecimentos para conferir");
  await expect(acoes).not.toContainText("Tarefa da gestão");
  await semPortal(page);
  await shot(page, `atendente${isMobile ? "-390" : ""}`, { fullPage: !isMobile });
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await acoes.getByRole("button", { name: "Ver todos: Meus combinados" }).click();
  const painel = page.getByRole("dialog", { name: "Meus combinados" });
  const itens = painel.getByTestId("proxima-acao-item");
  await expect(itens).toHaveCount(3);
  await expect(itens.nth(1)).toContainText("Mandar os valores da hidratação");
  await expect(itens.nth(1)).toContainText("atrasado ontem 09:00");
  await expect(itens.nth(2)).toContainText("Confirmar o horário de sábado");
  await expect(itens.nth(2)).not.toContainText("atrasado");
  expect(await itens.nth(1).getByRole("link", { name: "Mandar os valores da hidratação" }).getAttribute("href")).toBe(`/atendimento?lead=${d.dealId}`);
  if (isMobile) for (const botao of [painel.getByRole("button", { name: /Concluir: Mandar/ }), painel.getByRole("button", { name: "Veio: Dora Agendada" })]) {
    expect((await botao.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  await painel.getByRole("button", { name: "Concluir: Mandar os valores da hidratação" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Concluída: Mandar os valores da hidratação" })).toBeVisible();
  await expect(itens).toHaveCount(2);
  expect((await e2eSql("select done_at from tasks where title = 'Mandar os valores da hidratação'"))[0].done_at).not.toBeNull();

  const conf = painel.getByRole("region", { name: "Comparecimentos para conferir" });
  await expect(conf.getByTestId("comparecimento-item")).toHaveCount(1);
  await conf.getByRole("button", { name: "Veio: Dora Agendada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dora Agendada veio" })).toBeVisible();
  await expect(conf.getByTestId("comparecimento-item")).toHaveCount(0);
  expect((await e2eSql("select attendance from deals where id = $1", [c.dealId]))[0].attendance).toBe("compareceu");
});

test("O dia na Casa: 'Ver o dia todo' abre a tabela; filtro Na Casa; Chegou na linha leva a visita toda para Na Casa; CLIENTE PADRÃO fica de fora", async ({ page }) => {
  await e2eSql("delete from pro_notifications where appointment_id in (select id from appointments where client_name like 'Dia %' or client_name = 'CLIENTE PADRÃO')");
  await e2eSql("delete from appointments where origin = 'crm' and (client_name like 'Dia %' or client_name = 'CLIENTE PADRÃO')");
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ('Dia Cristiana', $1) returning id", [`${PREFIXO}8${Date.now() % 100000}${++corrida}`]);
  const [na] = await e2eSql("insert into contacts (name, phone_e164) values ('Dia Manoela', $1) returning id", [`${PREFIXO}7${Date.now() % 100000}${++corrida}`]);
  const daqui = new Date(Math.min(Date.now() + 2 * 3_600_000, Date.parse(em("23:50")))); // ainda hoje, mesmo rodando à noite
  const cedo = new Date(Math.max(Date.parse(em("00:30")), Date.now() - 3_600_000));
  const ins = (contact: string | null, name: string, pro: string, svc: string, at: Date, status: string) => e2eSql(
    `insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key, arrived_at)
     values ($1, $2, (select id from professionals where name = $3), $4, $5, 60, $6, 'crm', 'e2e:' || gen_random_uuid(), case when $6 = 'chegou' then $5::timestamptz end)`,
    [contact, name, pro, svc, at, status]);
  await ins(String(c.id), "Dia Cristiana", "Maiara", "LUZES E MECHAS", daqui, "confirmado");
  await ins(String(c.id), "Dia Cristiana", "Carla", "Coloração", daqui, "confirmado");
  await ins(String(na.id), "Dia Manoela", "Maiara", "Escova", cedo, "chegou");
  await ins(null, "CLIENTE PADRÃO", "Carla", "Corte", daqui, "confirmado");
  await login(page);
  await page.goto("/");
  const bloco = page.getByRole("region", { name: "O dia na Casa" });
  await expect(bloco.getByTestId("dia-numeros")).toBeVisible();
  await bloco.getByRole("button", { name: "Ver o dia todo: O dia na Casa" }).click();
  const painel = page.getByRole("dialog", { name: "O dia na Casa" });
  const linha = (nome: string) => painel.getByTestId("dia-linha").filter({ hasText: nome });
  await expect(linha("Dia Cristiana")).toHaveCount(1); // uma linha por cliente, não por serviço
  await expect(linha("Dia Cristiana")).toContainText("Luzes e Mechas"); // nunca TUDO EM MAIÚSCULAS
  await expect(linha("Dia Cristiana")).toContainText("Coloração");
  await expect(painel.getByTestId("dia-linha").filter({ hasText: /cliente padr/i })).toHaveCount(0);
  await shot(page, "hoje-dia-na-casa");

  await painel.getByRole("tab", { name: /^Na Casa/ }).click();
  await expect(linha("Dia Manoela")).toHaveCount(1);
  await expect(linha("Dia Manoela")).toContainText("Na Casa desde");
  await expect(linha("Dia Cristiana")).toHaveCount(0);

  await painel.getByRole("tab", { name: /^A chegar/ }).click();
  await linha("Dia Cristiana").getByRole("button", { name: "Chegou: Dia Cristiana" }).click();
  await expect.poll(async () => (await e2eSql("select status from appointments where contact_id = $1", [c.id])).map((r) => r.status)).toEqual(["chegou", "chegou"]);
  await painel.getByRole("tab", { name: /^Na Casa/ }).click();
  await expect(linha("Dia Cristiana")).toHaveCount(1);
  await linha("Dia Cristiana").click();
  await expect(page.getByRole("dialog", { name: "Dia Cristiana" }).getByTestId("visita-servico")).toHaveCount(2); // tocar na linha abre a visita
});
