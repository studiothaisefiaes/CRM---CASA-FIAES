import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot } from "./helpers";

/** T17b: triagem em massa, próxima ação, "Como conheceu?", Compareceu/Faltou e o histórico com de/para. */

async function isola(prefixo: string) {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${prefixo}%`]);
}
const leadId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 order by d.created_at desc limit 1", [phone]))[0].id);
const deal = async (id: string) => (await e2eSql(`select d.*, s.key as stage_key, u.email as owner_email from deals d join stages s on s.id = d.stage_id left join users u on u.id = d.owner_id where d.id = $1`, [id]))[0];
const noEstagio = (id: string, key: string) => e2eSql("update deals set stage_id = (select id from stages where key = $2), stage_entered_at = now() where id = $1", [id, key]);
const painel = (page: Page) => page.getByRole("region", { name: "Dados do cliente" });
const fila = (page: Page) => page.getByRole("listbox", { name: "Fila" });
const NOMES = ["Bianca Teles", "Carla Mendes", "Dora Lins", "Elaine Prado"];

/** Leads esperando resposta, com o prefixo do teste k (telefone +55 71 99741-k00i). */
async function leads(page: Page, k: number, n = 1) {
  await isola(`+557199741${k}`);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    await simulate(page, { phone: `71 99741-${k}00${i + 1}`, name: NOMES[i], text: "Oi, vocês fazem progressiva?" });
    await e2eSql("update deals set awaiting_reply_since = now() - interval '6 minutes' where contact_id = (select id from contacts where phone_e164 = $1)", [`+557199741${k}00${i + 1}`]);
    ids.push(await leadId(`+557199741${k}00${i + 1}`));
  }
  return ids;
}
function errosDoNavegador(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  return erros;
}
// Não deixa lead esperando para trás: o motor o marcaria como atrasado e contaria no título de outros specs (alertas).
test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199741%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});
const semPortal = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

test("triagem em massa: selecionar 3 e arquivar, com Desfazer", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const ids = await leads(page, 1, 4);
  await page.goto("/atendimento");
  await expect(fila(page).getByRole("option")).toHaveCount(4);
  await expect(fila(page)).toHaveAttribute("aria-multiselectable", "true");

  await page.getByRole("button", { name: "Selecionar" }).click();
  const barra = page.getByRole("region", { name: "Ações em massa" });
  await expect(barra).toContainText("Toque nos leads para marcar");
  await expect(barra.getByRole("button", { name: "Arquivar" })).toBeDisabled();
  for (const nome of NOMES.slice(0, 3)) await fila(page).getByRole("option", { name: new RegExp(nome) }).click();
  await expect(page).not.toHaveURL(/lead=/); // marcar não abre a conversa
  await expect(barra.getByTestId("selecionados")).toHaveText("3 selecionados");
  for (const nome of NOMES.slice(0, 3)) await expect(fila(page).getByRole("option", { name: new RegExp(nome) })).toHaveAttribute("aria-selected", "true");
  await expect(fila(page).getByRole("option", { name: new RegExp(NOMES[3]) })).toHaveAttribute("aria-selected", "false");
  // A gestão vê Atribuir a… e Mover etapa
  await expect(barra.getByRole("button", { name: "Atribuir a…" })).toBeVisible();
  await expect(barra.getByRole("button", { name: "Mover etapa" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
  await shot(page, "02-barra-massa-3-selecionados-desktop");

  await barra.getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 arquivados" })).toBeVisible();
  await expect(fila(page).getByRole("option")).toHaveCount(1);
  await expect(barra).toHaveCount(0); // a seleção termina
  for (const id of ids.slice(0, 3)) expect((await deal(id)).archived_at).not.toBeNull();
  expect((await deal(ids[3])).archived_at).toBeNull();
  expect((await e2eSql("select count(*)::int as n from audit_log where action = 'arquivou_lead' and entity_id = any($1::text[])", [ids]))[0].n).toBe(3);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 voltaram para a fila" })).toBeVisible();
  await expect(fila(page).getByRole("option")).toHaveCount(4);
  for (const id of ids) expect((await deal(id)).archived_at).toBeNull();
  expect((await e2eSql("select count(*)::int as n from deal_events where type = 'restaurado' and deal_id = any($1::uuid[])", [ids]))[0].n).toBe(3);
  expect(erros, "erros do navegador").toEqual([]);
});

test("seleção por teclado: Espaço marca (sem abrir), Esc sai; Atribuir e Mover etapa em massa", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const ids = await leads(page, 2, 3);
  await page.goto("/atendimento");
  const primeiro = fila(page).getByRole("option").first();
  await primeiro.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Cancelar" }).first()).toBeVisible(); // a seleção ligou
  await expect(primeiro).toHaveAttribute("aria-selected", "true");
  await expect(page).not.toHaveURL(/lead=/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("selecionados")).toHaveText("2 selecionados");
  await page.keyboard.press("Space"); // desmarca
  await expect(page.getByTestId("selecionados")).toHaveText("1 selecionado");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Ações em massa" })).toHaveCount(0);
  await expect(primeiro).toHaveAttribute("aria-selected", "false");

  // Caixinha ao passar o mouse: marca sem abrir o lead
  await fila(page).getByRole("option").nth(1).hover();
  await page.getByTestId("item-selecionar").nth(1).click();
  await expect(page.getByTestId("selecionados")).toHaveText("1 selecionado");
  await fila(page).getByRole("option").nth(2).click({ modifiers: ["Shift"] }); // intervalo
  await expect(page.getByTestId("selecionados")).toHaveText("2 selecionados");

  const barra = page.getByRole("region", { name: "Ações em massa" });
  await barra.getByRole("button", { name: "Atribuir a…" }).click();
  await page.getByRole("menuitem", { name: "Thaíse Fiaes" }).click(); // os leads novos nascem com a Ana
  await expect(page.getByRole("status").filter({ hasText: "2 leads atribuídos a Thaíse" })).toBeVisible();
  const donos = await e2eSql("select u.email from deals d join users u on u.id = d.owner_id where d.id = any($1::uuid[])", [ids]);
  expect(donos.filter((r) => r.email === "gestao@e2e.local")).toHaveLength(2);
  expect(donos.filter((r) => r.email === "ana@e2e.local")).toHaveLength(1);

  await page.getByRole("button", { name: "Selecionar" }).click();
  await fila(page).getByRole("option").nth(0).click();
  await fila(page).getByRole("option").nth(1).click();
  await barra.getByRole("button", { name: "Mover etapa" }).click();
  await expect(page.getByRole("menuitem", { name: "Agendado" })).toHaveCount(0); // etapas que pedem dados ficam de fora
  await expect(page.getByRole("menuitem", { name: "Fechado" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Follow-up 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: /2 leads movidos para Follow-up 1/ })).toBeVisible();
  const etapas = await e2eSql("select s.key from deals d join stages s on s.id = d.stage_id where d.id = any($1::uuid[])", [ids]);
  expect(etapas.filter((r) => r.key === "followup_1")).toHaveLength(2);
});

test("a atendente não vê Atribuir a…", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [id] = await leads(page, 3, 1);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.context().clearCookies();
  await login(page, "ana@e2e.local");
  await page.goto("/atendimento");
  await page.getByRole("button", { name: "Selecionar" }).click();
  await fila(page).getByRole("option").first().click();
  const barra = page.getByRole("region", { name: "Ações em massa" });
  await expect(barra.getByRole("button", { name: "Arquivar" })).toBeEnabled();
  await expect(barra.getByRole("button", { name: "Mover etapa" })).toBeVisible();
  await expect(barra.getByRole("button", { name: "Atribuir a…" })).toHaveCount(0);
});

test("próxima ação: criar (texto, quando e quem), concluir com 1 toque e trocar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const [id] = await leads(page, 4, 1);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  await expect(p.getByRole("heading", { name: "Bianca Teles" })).toBeVisible();

  await p.getByRole("button", { name: "Próxima ação" }).click();
  const dlg = page.getByRole("dialog", { name: "Próxima ação" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel("O que fazer")).toBeFocused();
  await expect(dlg.getByLabel("Quem faz")).toHaveValue(String((await e2eSql("select id from users where email = 'ana@e2e.local'"))[0].id)); // padrão: o dono
  // sem texto, explica
  await dlg.getByRole("button", { name: "Salvar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Escreva o que precisa ser feito.");
  // data passada: erro
  await dlg.getByLabel("O que fazer").fill("Mandar os valores");
  await dlg.getByLabel("Dia").fill("2020-01-01");
  await dlg.getByRole("button", { name: "Salvar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("já passou");
  await dlg.getByRole("radio", { name: "Amanhã 10h" }).click();
  await expect(dlg.getByLabel("Hora")).toHaveValue("10:00");
  await dlg.getByLabel("O que fazer").press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Próxima ação salva" })).toBeVisible();

  await expect(p.getByTestId("proxima-acao-titulo")).toHaveText("Mandar os valores");
  await expect(p.getByTestId("proxima-acao-quando")).toContainText("amanhã 10:00");
  await expect(p.getByTestId("proxima-acao-quando")).toContainText("Ana");
  const [t] = await e2eSql("select t.*, u.email from tasks t join users u on u.id = t.assignee_id where t.deal_id = $1 and t.kind = 'proxima_acao' and t.done_at is null", [id]);
  expect(t.title).toBe("Mandar os valores");
  expect(t.email).toBe("ana@e2e.local");
  expect(new Date(t.due_at as string).getTime()).toBeGreaterThan(Date.now());
  // na Fila, o item mostra a espera normal (a próxima ação entra na seção "Próximas ações de hoje" só quando vence hoje)
  await expect(p.getByRole("button", { name: "Próxima ação" })).toHaveCount(0); // já existe uma

  // Trocar: a nova substitui a atual (uma por lead) e a antiga fica cancelada no histórico
  await p.getByRole("button", { name: "Trocar" }).click();
  await expect(page.getByRole("dialog", { name: "Próxima ação" })).toContainText("Mandar os valores");
  await page.getByLabel("O que fazer").fill("Ligar para confirmar");
  await page.getByRole("radio", { name: "Em 3 dias" }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByTestId("proxima-acao-titulo")).toHaveText("Ligar para confirmar");
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(1);
  expect((await e2eSql("select payload from deal_events where deal_id = $1 and type = 'tarefa' and payload->>'acao' = 'cancelada'", [id]))).toHaveLength(1);

  // Concluir com 1 toque
  await p.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Concluída: Ligar para confirmar" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Próxima ação" })).toBeVisible();
  await expect(p.getByTestId("proxima-acao-titulo")).toHaveCount(0);
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(0);
  // o histórico conta a história
  await expect(p.getByRole("region", { name: "Hoje" }).getByText(/Próxima ação concluída: Ligar para confirmar/)).toBeVisible();
  await expect(p.getByText(/Próxima ação criada: Mandar os valores · amanhã 10:00/)).toBeVisible();
  expect(erros, "erros do navegador").toEqual([]);
});

test("Como conheceu? grava a origem com auditoria e a Fila passa a mostrar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [a, b] = await leads(page, 5, 2);
  await page.goto(`/atendimento?lead=${a}`);
  const p = painel(page);
  const card = p.getByTestId("como-conheceu");
  await expect(card).toBeVisible();
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toContainText("Não identificada");
  for (const o of ["Indicação", "Instagram", "Google", "Passou na frente", "Outra"]) await expect(card.getByRole("button", { name: o, exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "WhatsApp" })).toHaveCount(0); // canal não é origem

  await card.getByRole("button", { name: "Instagram", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Origem salva" })).toBeVisible();
  await expect(p.getByTestId("como-conheceu")).toHaveCount(0);
  await expect(p.getByRole("term").filter({ hasText: "Origem" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toContainText("Instagram");
  const d = await deal(a);
  expect(d.source_label).toBe("Instagram");
  const ev = await e2eSql("select payload from deal_events where deal_id = $1 and type = 'campo_alterado'", [a]);
  expect(ev.at(-1)?.payload).toMatchObject({ campos: [{ campo: "origin", para: "Instagram" }] });
  await expect(p.getByText(/Origem: não identificada → Instagram/)).toBeVisible(); // o de/para no histórico

  // Outra: texto livre
  await page.goto(`/atendimento?lead=${b}`);
  const card2 = painel(page).getByTestId("como-conheceu");
  await card2.getByRole("button", { name: "Outra", exact: true }).click();
  await card2.getByRole("button", { name: "Salvar" }).click();
  await expect(card2.getByRole("alert")).toContainText("Escreva como a cliente conheceu a Casa.");
  await card2.getByLabel("Como a cliente conheceu a Casa").fill("Vizinha do salão");
  await card2.getByLabel("Como a cliente conheceu a Casa").press("Enter");
  await expect(page.getByRole("option", { name: /Carla Mendes/ })).toContainText("Vizinha do salão");
  expect((await deal(b)).source_label).toBe("Vizinha do salão");
});

test("Compareceu/Faltou: na Fila (conferir) e no painel; Faltou cria a próxima ação Remarcar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const [a, b] = await leads(page, 6, 2);
  for (const id of [a, b]) {
    await noEstagio(id, "agendado");
    await e2eSql("update deals set scheduled_at = now() - interval '2 hours', awaiting_reply_since = null, owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  }
  await page.goto("/atendimento");
  const conferir = page.getByRole("region", { name: "Conferir comparecimento" });
  await expect(conferir.getByTestId("conferir-item")).toHaveCount(2);
  await expect(conferir).toContainText("Bianca Teles");

  // botões ficam fora do listbox (nada interativo dentro de uma option)
  expect(await fila(page).getByRole("button").count()).toBe(0);

  await conferir.getByRole("button", { name: "Faltou: Bianca Teles" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bianca Teles faltou · próxima ação: Remarcar" })).toBeVisible();
  await expect(conferir.getByTestId("conferir-item")).toHaveCount(1);
  expect((await deal(a)).attendance).toBe("faltou");
  const [t] = await e2eSql("select title, due_at, assignee_id from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [a]);
  expect(t.title).toBe("Remarcar com Bianca Teles");
  expect(new Date(t.due_at as string).getTime()).toBeGreaterThan(Date.now());
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'comparecimento' and done_at is null", [a])).toHaveLength(0);

  // No painel do cliente: o lead Agendado tem os dois botões; o registrado fica marcado
  await page.goto(`/atendimento?lead=${a}`);
  const p = painel(page);
  await expect(p.getByRole("button", { name: "Faltou" })).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByTestId("proxima-acao-titulo")).toHaveText("Remarcar com Bianca Teles");
  await expect(p.getByText(/Comparecimento: Faltou \(/)).toBeVisible(); // no histórico

  await page.goto(`/atendimento?lead=${b}`);
  await painel(page).getByRole("button", { name: "Compareceu" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Carla Mendes compareceu" })).toBeVisible();
  await expect(painel(page).getByRole("button", { name: "Compareceu" })).toHaveAttribute("aria-pressed", "true");
  expect((await deal(b)).attendance).toBe("compareceu");
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [b])).toHaveLength(0); // compareceu não cria ação
  await page.goto("/atendimento");
  await expect(page.getByRole("region", { name: "Conferir comparecimento" })).toHaveCount(0); // nada mais a conferir
  expect(erros, "erros do navegador").toEqual([]);
});

test("histórico: de/para dos campos por dia, sem mensagens, com Ver mais", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const [id] = await leads(page, 7, 1);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  const valor = p.getByLabel("Valor (R$)");
  await valor.fill("100");
  await valor.blur();
  await expect(p.getByText("salvo").first()).toBeVisible();
  await valor.fill("150,00");
  await valor.blur();
  await expect(p.getByText(/Valor: R\$ 100,00 → R\$ 150,00 \(Thaíse, \d{2}:\d{2}\)/)).toBeVisible();
  await expect(p.getByText(/Valor: vazio → R\$ 100,00 \(Thaíse, \d{2}:\d{2}\)/)).toBeVisible();
  const hoje = p.getByRole("region", { name: "Hoje" });
  await expect(hoje).toBeVisible();
  // mensagens não entram: já estão na conversa
  await expect(p.getByText("Mensagem recebida")).toHaveCount(0);
  await expect(p.getByText("Mensagem enviada")).toHaveCount(0);
  expect((await e2eSql("select 1 from deal_events where deal_id = $1 and type = 'mensagem_recebida'", [id])).length).toBeGreaterThan(0); // existe no banco, só não é listado

  // Ver mais: 15 por vez
  await e2eSql("insert into deal_events (deal_id, type, payload, created_at) select $1, 'assumiu', '{}'::jsonb, now() - (g || ' minutes')::interval from generate_series(1, 30) g", [id]);
  await page.reload();
  await expect(p.getByTestId("historico-item")).toHaveCount(15);
  await p.getByRole("button", { name: /Ver mais/ }).click();
  await expect(p.getByTestId("historico-item")).toHaveCount(30);
  await p.getByRole("button", { name: /Ver mais/ }).click();
  await expect(p.getByRole("button", { name: /Ver mais/ })).toHaveCount(0);
  // eventos de ontem ficam sob "Ontem"
  await e2eSql("update deal_events set created_at = created_at - interval '1 day' where deal_id = $1 and type = 'assumiu' and created_at < now() - interval '25 minutes'", [id]);
  await page.reload();
  await p.getByRole("button", { name: /Ver mais/ }).click();
  await expect(p.getByRole("region", { name: "Ontem" })).toBeVisible();

  // painel completo (próxima ação + histórico) para o print
  await e2eSql("delete from deal_events where deal_id = $1 and type = 'assumiu'", [id]);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: "Próxima ação" }).click();
  await page.getByLabel("O que fazer").fill("Mandar os valores da progressiva");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(painel(page).getByTestId("proxima-acao-titulo")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 2500 }); // alto, para o painel inteiro caber no print
  await semPortal(page);
  await expect(page.getByRole("status").filter({ hasText: "Próxima ação salva" })).toHaveCount(0); // o aviso sai antes do print
  await shot(page, "01-painel-proxima-acao-e-historico-desktop", { clip: { x: 1140, y: 0, width: 300, height: 2500 } });
  expect(erros, "erros do navegador").toEqual([]);
});

test.describe("celular: triagem em massa e próxima ação em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });

  test("Selecionar no topo da Fila, 3 marcados, barra em alvos de 44 px e arquivar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const erros = errosDoNavegador(page);
    await login(page);
    const ids = await leads(page, 8, 4);
    await page.goto("/atendimento");
    const sel = page.getByRole("button", { name: "Selecionar" });
    expect((await sel.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await sel.click();
    for (const nome of NOMES.slice(0, 3)) await fila(page).getByRole("option", { name: new RegExp(nome) }).click();
    await expect(page).toHaveURL(/\/atendimento$/); // marcar não abre a conversa
    await expect(page.getByTestId("item-caixa")).toHaveCount(4); // caixinhas visíveis em todos
    const barra = page.getByRole("region", { name: "Ações em massa" });
    await expect(barra.getByTestId("selecionados")).toHaveText("3 selecionados");
    for (const b of await barra.getByRole("button").all()) expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(43.9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await semPortal(page);
    await shot(page, "03-celular-selecao-3-marcados-390", { clip: { x: 0, y: 0, width: 390, height: 700 } });
    // Mover etapa abre para cima e cabe na tela
    await barra.getByRole("button", { name: "Mover etapa" }).click();
    const menu = page.getByRole("menu", { name: "Mover etapa" });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await barra.getByRole("button", { name: "Arquivar" }).click();
    await expect(page.getByRole("status").filter({ hasText: "3 arquivados" })).toBeVisible();
    await expect(fila(page).getByRole("option")).toHaveCount(1);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(fila(page).getByRole("option")).toHaveCount(4);
    for (const id of ids) expect((await deal(id)).archived_at).toBeNull();
    expect(erros, "erros do navegador").toEqual([]);
  });

  test("aba Dados: próxima ação com alvos de 44 px e campos de 16 px; Como conheceu? e Compareceu/Faltou", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const [id] = await leads(page, 9, 1);
    await noEstagio(id, "agendado");
    await e2eSql("update deals set scheduled_at = now() - interval '1 hour' where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
    await lead.getByRole("tab", { name: "Dados" }).click();
    const p = painel(page);
    for (const alvo of [p.getByRole("button", { name: "Compareceu" }), p.getByRole("button", { name: "Faltou" }), p.getByRole("button", { name: "Próxima ação" }), p.getByTestId("como-conheceu").getByRole("button", { name: "Instagram", exact: true }), p.getByTestId("como-conheceu").getByRole("button", { name: "Outra", exact: true })]) {
      expect((await alvo.boundingBox())!.height, await alvo.innerText()).toBeGreaterThanOrEqual(43.9);
    }
    await p.getByRole("button", { name: "Próxima ação" }).click();
    const dlg = page.getByRole("dialog", { name: "Próxima ação" });
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(500);
    const box = (await dlg.boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height); // colada embaixo
    for (const campo of [dlg.getByLabel("O que fazer"), dlg.getByLabel("Dia"), dlg.getByLabel("Hora"), dlg.getByLabel("Quem faz")]) {
      expect(await campo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), "fonte do campo").toBeGreaterThanOrEqual(16);
    }
    for (const chip of await dlg.getByRole("radio").all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await dlg.getByLabel("O que fazer").fill("Mandar os valores");
    await semPortal(page);
    await shot(page, "04-celular-proxima-acao-sheet-390");
    await dlg.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Próxima ação salva" })).toBeVisible();
    await expect(p.getByTestId("proxima-acao-titulo")).toHaveText("Mandar os valores");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.getByRole("button", { name: "Faltou" }).click();
    await expect(p.getByRole("button", { name: "Faltou" })).toHaveAttribute("aria-pressed", "true");
    await expect(p.getByTestId("proxima-acao-titulo")).toHaveText("Remarcar com Bianca Teles");
    // aba Histórico: só a linha do tempo, com o de/para
    await lead.getByRole("tab", { name: "Histórico" }).click();
    await expect(p.getByRole("region", { name: "Hoje" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /salva|faltou/ })).toHaveCount(0); // os avisos saem antes do print
    await shot(page, "05-celular-historico-390", { clip: { x: 0, y: 0, width: 390, height: 664 } });
  });
});
