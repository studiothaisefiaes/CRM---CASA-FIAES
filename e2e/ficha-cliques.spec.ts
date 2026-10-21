import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, ageLead } from "./helpers";

/** Lote 2: todos os pontos da tabela de cliques da auditoria de Contatos abrem a ficha (ou o painel com "Abrir ficha da cliente"). */
const fone = (i: number) => `+557199978${String(i).padStart(4, "0")}`;
const digitado = (i: number) => `71 99978-${String(i).padStart(4, "0")}`;
const contactId = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);
const dealId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.closed_at is null and d.archived_at is null", [phone]))[0].id);
const naFicha = async (page: Page, id: string) => { await expect(page).toHaveURL(new RegExp(`/contatos/${id}$`)); await expect(page.getByTestId("frase-situacao")).toBeVisible(); };

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199978%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("conversa, Quadro, Jornada, Hoje, sino, Agenda e Relatórios levam à ficha", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  test.setTimeout(180_000);
  await login(page);
  await simulate(page, { phone: digitado(1), name: "Olga Fictícia", text: "Oi, tem horário sábado?" });
  const id = await contactId(fone(1));
  const deal = await dealId(fone(1));

  // Conversa: nome do cabeçalho
  await page.goto(`/atendimento/${deal}`);
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);

  // Hoje › Esperando resposta (a cliente escreveu e ninguém respondeu): o bloco é um resumo; a lista com a ficha fica no painel.
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir as conversas: Esperando resposta" }).click();
  await page.getByRole("dialog", { name: "Esperando resposta" }).getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);

  // Hoje › Meus combinados e Aniversário hoje (no painel de cada bloco)
  await e2eSql(`insert into tasks (deal_id, contact_id, kind, title, due_at, assignee_id) select $1, $2, 'proxima_acao', 'Mandar valores Olga', now() + interval '1 hour', u.id from users u where u.email = 'gestao@e2e.local'`, [deal, id]);
  await e2eSql("update contacts set birth_day = extract(day from (now() at time zone 'America/Bahia'))::int, birth_month = extract(month from (now() at time zone 'America/Bahia'))::int where id = $1", [id]);
  await page.goto("/");
  await page.getByRole("button", { name: "Ver todos: Meus combinados" }).click();
  await page.getByRole("dialog", { name: "Meus combinados" }).getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);
  await page.goto("/");
  await page.getByRole("button", { name: "Ver todos: Aniversário hoje" }).click();
  await page.getByRole("dialog", { name: "Aniversário hoje" }).getByRole("link", { name: /Ficha de Olga Fictícia/ }).first().click();
  await naFicha(page, id);

  // Quadro: o cartão abre o mesmo painel da Fila; nele, o nome leva à ficha
  await page.goto(`/funil?lead=${deal}`);
  await page.getByRole("dialog", { name: /Conversa com/ }).getByRole("heading", { level: 2 }).getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);

  // Jornada: o nome embaixo do círculo
  await page.goto("/jornada");
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);

  // Sino: aviso de espera, botão "Ficha"
  ageLead(fone(1), 40);
  await page.goto("/");
  await page.getByRole("button", { name: /^Alertas/ }).click();
  await page.getByTestId("alerts-panel").getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);

  // Agenda: horário do Avec da cliente hoje → painel → "Abrir ficha da cliente"
  await e2eSql(`insert into appointments (contact_id, starts_at, status, service_label, external_key) values ($1, now() + interval '10 minutes', 'agendado', 'Escova', 'e2e:cliques:ag') on conflict do nothing`, [id]);
  await page.goto("/agenda?v=lista"); // 6.10: a Agenda abre por profissional; a lista mostra os horários sem profissional
  await page.getByTestId("agenda-item").filter({ hasText: "Olga Fictícia" }).first().getByRole("button").first().click();
  await page.getByRole("link", { name: "Abrir ficha da cliente" }).click();
  await naFicha(page, id);

  // Relatórios › Análise › cobranças vencidas (gestão; só venda fechada com valor a receber): o nome na lista
  await e2eSql(`insert into deals (contact_id, stage_id, value_cents, charge_at, closed_at, created_at)
    select $1, s.id, 30000, now() - interval '1 day', now() - interval '2 days', now() - interval '3 days' from stages s where s.key = 'fechado'`, [id]);
  await page.goto("/relatorios?aba=analise");
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);
});
