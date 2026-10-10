import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot } from "./helpers";

/** T18: ficha do contato, busca por nome/telefone/trecho de mensagem, "Iniciar conversa" e triagem em massa em Contatos. */

const semPortal = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
const telefone = (serie: number, i: number) => `+557199976${serie}${String(i).padStart(3, "0")}`;
const digitado = (serie: number, i: number) => `71 99976-${serie}${String(i).padStart(3, "0")}`;
const contactId = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);
const abertos = async (phone: string) => e2eSql("select d.* from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null and d.closed_at is null", [phone]);
const ignorado = async (phone: string) => Boolean((await e2eSql("select ignored from contacts where phone_e164 = $1", [phone]))[0].ignored);
function errosDoNavegador(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  return erros;
}
/** Contatos com lead aberto, um por nome. */
async function contatos(page: Page, serie: number, nomes: string[]) {
  for (const [i, nome] of nomes.entries()) await simulate(page, { phone: digitado(serie, i + 1), name: nome, text: "Oi, tudo bem?" });
}

// Não deixa lead esperando para trás: o motor o marcaria como atrasado e contaria no título de outros specs.
test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199976%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("buscar por trecho de mensagem, abrir a ficha e iniciar a conversa", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const heloisa = telefone(1, 1);
  await simulate(page, { phone: digitado(1, 1), name: "Heloísa Vidigal", text: "Boa tarde, vocês fazem o tratamento de cauterização capilar?" });
  await simulate(page, { phone: digitado(1, 1), name: "Heloísa Vidigal", text: "<img src=x onerror=\"window.__xss=1\"> e quanto custa a cauterização?" });
  await simulate(page, { phone: digitado(1, 2), name: "Irene Castro", text: "Quero marcar um corte" });
  // Contato sem nenhum lead (o "Iniciar conversa" de verdade)
  await e2eSql("insert into contacts (phone_e164, name) values ($1, 'Janaína Semlead')", [telefone(1, 3)]);
  // Um histórico mais rico para a ficha: venda antiga, mensagem da Casa e origem
  const id = await contactId(heloisa);
  await e2eSql(`insert into deals (contact_id, stage_id, origin, source_label, value_cents, closed_at, created_at, stage_entered_at)
    select $1, s.id, 'Instagram', 'Instagram', 28000, now() - interval '40 days', now() - interval '42 days', now() - interval '40 days' from stages s where s.key = 'fechado'`, [id]);
  await e2eSql("update contacts set is_client = true, client_since = now() - interval '42 days', last_service_at = now() - interval '40 days' where id = $1", [id]);
  await e2eSql("insert into messages (contact_id, deal_id, direction, kind, body, status, created_at) select $1, d.id, 'out', 'text', 'Claro! Temos horário na quinta às 14h.', 'sent', now() - interval '2 minutes' from deals d where d.contact_id = $1 and d.closed_at is null limit 1", [id]);

  await page.goto("/contatos");
  const busca = page.getByRole("searchbox", { name: /Buscar/ });
  await busca.fill("cauterização");
  await expect(page).toHaveURL(/\/contatos\?q=cauteriza/); // o estado da busca fica na URL
  const lista = page.getByRole("table");
  await expect(lista.getByRole("link", { name: /Heloísa Vidigal/ })).toBeVisible();
  await expect(lista.getByRole("link", { name: /Irene Castro/ })).toHaveCount(0);
  // O trecho aparece destacado, e HTML de mensagem nunca vira HTML
  await expect(lista.locator("mark").first()).toHaveText(/cauteriza/i);
  expect(await page.locator("img[src='x']").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await semPortal(page);
  await shot(page, "02-busca-trecho-destacado-desktop");

  // Voltar do navegador: o campo acompanha o ?q= (busca → chip "Só clientes" empilha uma entrada → outra busca troca o termo → voltar)
  await page.getByRole("link", { name: "Só clientes" }).click();
  await expect(page).toHaveURL(/clientes=1/);
  await busca.fill("Irene");
  await expect(page).toHaveURL(/q=Irene/);
  await page.goBack();
  await expect(page).toHaveURL(/q=cauteriza/);
  await expect(page).not.toHaveURL(/clientes=1/);
  await expect(busca).toHaveValue("cauterização");
  await expect(lista.getByRole("link", { name: /Heloísa Vidigal/ })).toBeVisible();

  // Atualizar a página mantém a busca (ela mora na URL)
  await page.reload();
  await expect(busca).toHaveValue("cauterização");
  await expect(lista.getByRole("link", { name: /Heloísa Vidigal/ })).toBeVisible();

  await lista.getByRole("link", { name: /Heloísa Vidigal/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contatos/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heloísa Vidigal");
  await expect(page.locator("dl[aria-label='Resumo']")).toContainText("Instagram"); // a origem real do primeiro lead
  await expect(page.locator("section[aria-labelledby='lead-atual']")).toContainText("Abrir na Fila");
  await expect(page.locator("section[aria-labelledby='valores']")).toContainText("R$ 280"); // a gestão vê vendas e total gasto
  const hist = page.getByTestId("historico");
  await expect(hist).toContainText("Boa tarde, vocês fazem o tratamento de cauterização capilar?");
  await expect(hist).toContainText("Claro! Temos horário na quinta às 14h.");
  await expect(hist).toContainText("Hoje");
  // A mensagem com HTML aparece como texto
  await expect(hist).toContainText("<img src=x");
  await semPortal(page);
  await shot(page, "01-ficha-contato-desktop", { fullPage: true });

  // Filtro do histórico
  await page.getByRole("radio", { name: "Atendimento" }).click();
  await expect(hist).not.toContainText("Claro! Temos horário");
  await expect(hist).toContainText("Lead criado");
  await page.getByRole("radio", { name: "Tudo" }).click();

  // "Continuar conversa" (já tem lead aberto): leva ao mesmo lead, sem duplicar
  const aberto = await abertos(heloisa);
  expect(aberto).toHaveLength(1);
  await page.getByRole("button", { name: "Continuar conversa" }).click();
  await expect(page).toHaveURL(new RegExp(`/atendimento/${String(aberto[0].id)}\\?compose=1`));
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeFocused();
  expect(await abertos(heloisa)).toHaveLength(1);

  // "Iniciar conversa" num contato sem lead: cria o lead, abre a Fila nele com o campo em foco e não envia nada
  await page.goto("/contatos");
  await busca.fill("Semlead");
  await page.getByRole("table").getByRole("link", { name: /Janaína Semlead/ }).click();
  await expect(page.locator("section[aria-labelledby='lead-atual']")).toContainText("Nenhum lead em andamento");
  await page.getByRole("button", { name: "Iniciar conversa" }).click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}\?compose=1/);
  const novo = await abertos(telefone(1, 3));
  expect(novo).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(String(novo[0].id)));
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeFocused();
  await expect(page.getByRole("region", { name: /Lead Janaína Semlead/ })).toBeVisible();
  expect((await e2eSql("select count(*)::int as n from messages where contact_id = $1", [await contactId(telefone(1, 3))]))[0].n).toBe(0);
  expect((await e2eSql("select count(*)::int as n from outbox where deal_id = $1", [novo[0].id]))[0].n).toBe(0);
  expect(novo[0].owner_id).not.toBeNull();

  // Voltar à ficha e iniciar de novo não duplica
  await page.goto(`/contatos/${await contactId(telefone(1, 3))}`);
  await page.getByRole("button", { name: "Continuar conversa" }).click();
  await expect(page).toHaveURL(new RegExp(String(novo[0].id)));
  expect(await abertos(telefone(1, 3))).toHaveLength(1);
  expect(erros, "erros do navegador").toEqual([]);
});

test("id malformado dá 404 (e não erro 500), na ficha e na conversa; histórico longo avisa o corte", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  for (const rota of ["/contatos/" + "-".repeat(36), "/atendimento/" + "-".repeat(36), "/atendimento/" + "-".repeat(36) + "/cliente"]) {
    // /atendimento/[id] tem loading.tsx: a resposta já começou em 200 e a página de "não encontrada" chega no fluxo. Nos dois casos, nunca o erro 500.
    const r = await page.goto(rota);
    expect(r?.status(), rota).not.toBe(500);
    await expect(page.getByText("This page could not be found.").or(page.getByText(/não encontrad/i)).first(), rota).toBeVisible();
  }
  await contatos(page, 6, ["Historia Longa"]);
  await e2eSql("insert into deal_events (deal_id, type, payload, created_at) select d.id, 'campo_alterado', '{\"campos\":[{\"campo\":\"observations\",\"de\":null,\"para\":\"x\"}]}'::jsonb, now() - (g || ' minutes')::interval from deals d join contacts c on c.id = d.contact_id, generate_series(1, 320) g where c.phone_e164 = $1", [telefone(6, 1)]);
  await page.goto(`/contatos/${await contactId(telefone(6, 1))}`);
  await expect(page.getByTestId("aviso-eventos")).toHaveText(/Mostrando os 300 eventos mais recentes/);
});

test("busca por telefone, contato 'Não é cliente' fora da busca padrão e 'Voltar a ser cliente'", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await contatos(page, 2, ["Larissa Quaresma"]);
  const fone = telefone(2, 1);
  const id = await contactId(fone);
  await page.goto("/contatos?q=99976-2001");
  await expect(page.getByRole("table").getByRole("link", { name: /Larissa Quaresma/ })).toBeVisible();

  // "Não é cliente" pelo lead: some da busca padrão
  await e2eSql("update deals set archived_at = now(), archived_stage_id = stage_id where contact_id = $1", [id]);
  await e2eSql("update contacts set ignored = true where id = $1", [id]);
  await page.goto("/contatos?q=Larissa");
  await expect(page.getByText("Nada encontrado")).toBeVisible();
  await page.getByRole("link", { name: "Buscar também em “Não é cliente”" }).click();
  await expect(page).toHaveURL(/ignorados=1/);
  const linha = page.getByRole("table").getByRole("row", { name: /Larissa Quaresma/ });
  await expect(linha).toContainText("Não é cliente"); // marcado, não escondido

  // A ficha mostra o estado e oferece "Voltar a ser cliente"
  await linha.getByRole("link", { name: /Larissa Quaresma/ }).click();
  await expect(page.locator("section[aria-labelledby='lead-atual']")).toContainText("Não é cliente");
  await expect(page.getByRole("button", { name: "Iniciar conversa" })).toHaveCount(0);
  await page.getByRole("button", { name: "Voltar a ser cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Voltou a ser cliente" })).toBeVisible();
  await expect.poll(() => ignorado(fone)).toBe(false);
  expect(await abertos(fone)).toHaveLength(1); // o lead voltou para a fila
  await expect(page.getByRole("button", { name: "Continuar conversa" })).toBeVisible();
});

test("triagem em massa em Contatos: selecionar, 'Não é cliente' e Desfazer", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const nomes = ["Triagem Alfa", "Triagem Beta", "Triagem Gama"];
  await contatos(page, 3, nomes);
  await page.goto("/contatos?q=Triagem");
  const tabela = page.getByRole("table");
  await expect(tabela.getByRole("row")).toHaveCount(4); // cabeçalho + 3
  await page.getByRole("button", { name: "Selecionar" }).click();
  const barra = page.getByRole("region", { name: "Ações em massa" });
  await expect(barra).toContainText("Toque nos contatos para marcar");
  await expect(barra.getByRole("button", { name: "Não é cliente" })).toBeDisabled();
  await tabela.getByRole("checkbox", { name: /Triagem Alfa/ }).click();
  await tabela.getByRole("checkbox", { name: /Triagem Beta/ }).click();
  await expect(page).toHaveURL(/\/contatos\?q=Triagem$/); // marcar não abre a ficha
  await expect(barra.getByTestId("selecionados")).toHaveText("2 selecionados");
  await expect(page.getByTestId("anuncio-selecao")).toHaveText("2 selecionados"); // anunciado para o leitor de tela
  await expect(tabela.getByRole("checkbox", { name: /Triagem Alfa/ })).toHaveAttribute("aria-checked", "true");
  await expect(tabela.getByRole("checkbox", { name: /Triagem Gama/ })).toHaveAttribute("aria-checked", "false");
  await semPortal(page);
  await shot(page, "03-triagem-contatos-2-selecionados-desktop");

  await barra.getByRole("button", { name: "Não é cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 contatos marcados como “Não é cliente”" })).toBeVisible();
  await expect(tabela.getByRole("row")).toHaveCount(2); // sobrou a Gama
  await expect(barra).toHaveCount(0);
  expect(await ignorado(telefone(3, 1))).toBe(true);
  expect(await ignorado(telefone(3, 2))).toBe(true);
  expect(await ignorado(telefone(3, 3))).toBe(false);
  expect((await e2eSql("select count(*)::int as n from audit_log where action = 'arquivou_lead' and entity_id in (select d.id::text from deals d join contacts c on c.id = d.contact_id where c.phone_e164 in ($1, $2))", [telefone(3, 1), telefone(3, 2)]))[0].n).toBe(2);
  expect(await abertos(telefone(3, 1))).toHaveLength(0);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 voltaram" })).toBeVisible();
  await expect(tabela.getByRole("row")).toHaveCount(4);
  expect(await ignorado(telefone(3, 1))).toBe(false);
  expect(await abertos(telefone(3, 1))).toHaveLength(1);
  expect(await abertos(telefone(3, 2))).toHaveLength(1);
  expect(erros, "erros do navegador").toEqual([]);
});

test("atendente: o em massa age só no que é dela ou sem dono; a ficha não mostra valores", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await contatos(page, 4, ["Escopo Alfa", "Escopo Beta", "Escopo Gama"]);
  const dono = (i: number, email: string | null) => e2eSql(
    `update deals set owner_id = ${email ? "(select id from users where email = $2)" : "null"} where contact_id = (select id from contacts where phone_e164 = $1)`,
    email ? [telefone(4, i), email] : [telefone(4, i)]);
  await dono(1, "ana@e2e.local"); await dono(2, null); await dono(3, "gestao@e2e.local");
  await page.context().clearCookies();
  await login(page, "ana@e2e.local");
  await page.goto("/contatos?q=Escopo");
  await page.getByRole("button", { name: "Selecionar" }).click();
  for (const n of ["Alfa", "Beta", "Gama"]) await page.getByRole("table").getByRole("checkbox", { name: new RegExp(`Escopo ${n}`) }).click();
  await page.getByRole("region", { name: "Ações em massa" }).getByRole("button", { name: "Não é cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 contatos marcados como “Não é cliente” · 1 ficou de fora" })).toBeVisible();
  expect(await ignorado(telefone(4, 1))).toBe(true);
  expect(await ignorado(telefone(4, 2))).toBe(true);
  expect(await ignorado(telefone(4, 3))).toBe(false); // da gestora: intocado

  // Individual vale para qualquer um: a ficha do contato da gestora abre e a atendente pode iniciar conversa
  await page.goto(`/contatos/${await contactId(telefone(4, 3))}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Escopo Gama");
  await expect(page.locator("section[aria-labelledby='valores']")).toHaveCount(0); // valores são da gestão
  await expect(page.getByRole("button", { name: "Continuar conversa" })).toBeVisible();
});

test("celular: lista em cartões sem rolagem lateral, alvos de 44 px, busca e ficha", async ({ page, isMobile }) => {
  test.skip(!isMobile, "celular");
  const erros = errosDoNavegador(page);
  await login(page);
  await simulate(page, { phone: digitado(5, 1), name: "Maria Aparecida dos Santos Albuquerque", text: "Bom dia! Queria saber o valor da hidratação com botox capilar e se tem horário no sábado de manhã." });
  await simulate(page, { phone: digitado(5, 2), name: "Bruna Lima", text: "Oi, tudo bem?" });
  await e2eSql("update contacts set is_client = true, client_since = now() - interval '300 days' where phone_e164 = $1", [telefone(5, 2)]);
  await page.goto("/contatos");
  const cartoes = page.getByRole("list", { name: "Contatos" });
  await expect(cartoes).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const busca = page.getByRole("searchbox", { name: /Buscar/ });
  expect(await busca.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  for (const alvo of [busca, page.getByRole("link", { name: "Só clientes" }), page.getByRole("link", { name: /Incluir “Não é cliente”/ }), page.getByRole("button", { name: "Selecionar" }), cartoes.getByRole("link").first()]) {
    expect(Math.round((await alvo.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  }
  await busca.fill("hidratação");
  await expect(page).toHaveURL(/q=hidrata/);
  await expect(cartoes.getByRole("link", { name: /Maria Aparecida/ })).toBeVisible();
  await expect(cartoes.getByRole("link", { name: /Bruna Lima/ })).toHaveCount(0);
  await expect(cartoes.locator("mark").first()).toHaveText(/hidrata/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await semPortal(page);
  await shot(page, "03-lista-celular-390-busca", { clip: { x: 0, y: 0, width: 390, height: 560 } });

  // Seleção em massa no celular: a barra fica acima da navegação inferior e os botões têm 44 px
  await page.getByRole("button", { name: "Selecionar" }).click();
  await cartoes.getByRole("checkbox", { name: /Maria Aparecida/ }).click();
  const barra = page.getByRole("region", { name: "Ações em massa" });
  await expect(barra.getByTestId("selecionados")).toHaveText("1 selecionado");
  expect(Math.round((await barra.getByRole("button", { name: "Não é cliente" }).boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Cancelar" }).first().click();

  // Ficha no celular
  await cartoes.getByRole("link", { name: /Maria Aparecida/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Maria Aparecida");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(Math.round((await page.getByRole("button", { name: "Continuar conversa" }).boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await semPortal(page);
  await shot(page, "04-ficha-celular-390", { clip: { x: 0, y: 0, width: 390, height: 760 } });
  expect(erros, "erros do navegador").toEqual([]);
});
