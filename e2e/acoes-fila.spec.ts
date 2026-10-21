import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot, isola } from "./helpers";

// Lote 6B: no modo "consulta" (o de produção até o dono escolher), "Agendar horário" na conversa continua a folha antiga (decisão 2 do plano).
test.beforeAll(async () => { await e2eSql(`insert into settings (key, value) values ('agenda_modo', '"consulta"') on conflict (key) do update set value = excluded.value`); });
test.afterAll(async () => { await e2eSql(`update settings set value = '"dupla"' where key = 'agenda_modo'`); });

/** T17b: triagem em massa, próxima ação, "Como conheceu?", Compareceu/Faltou e o histórico com de/para. */

const leadId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 order by d.created_at desc limit 1", [phone]))[0].id);
const deal = async (id: string) => (await e2eSql(`select d.*, s.key as stage_key, u.email as owner_email from deals d join stages s on s.id = d.stage_id left join users u on u.id = d.owner_id where d.id = $1`, [id]))[0];
const noEstagio = (id: string, key: string) => e2eSql("update deals set stage_id = (select id from stages where key = $2), stage_entered_at = now() where id = $1", [id, key]);
const painel = (page: Page) => page.getByRole("region", { name: "Dados do cliente" });
const fila = (page: Page) => page.getByRole("listbox", { name: "Fila" });
const NOMES = ["Bianca Teles", "Carla Mendes", "Dora Lins", "Elaine Prado"];
/** Dia (AAAA-MM-DD) de Salvador, `dias` depois de hoje. */
const diaBahia = (dias: number) => new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
const barraMassa = (page: Page) => page.getByRole("region", { name: "Ações para as marcadas" });
/** Retomar… (diálogo único): sem mensagem vira lembrete; `dias` e `hora` pelo "Escolher". */
async function retomar(page: Page, scope: ReturnType<Page["getByRole"]>, o: { motivo: string; dias?: number; hora?: string; texto?: string }) {
  await scope.getByRole("button", { name: "Retomar…" }).click();
  const dlg = page.getByRole("dialog", { name: /^Retomar/ });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("radio", { name: "Escolher" }).click();
  await dlg.getByLabel("Dia").fill(diaBahia(o.dias ?? 3));
  await dlg.getByLabel("Hora").fill(o.hora ?? "10:00");
  await dlg.getByPlaceholder("Ex.: ver se fechou o orçamento").fill(o.motivo);
  if (o.texto) await dlg.getByLabel("Mensagem (opcional)").fill(o.texto);
  return dlg;
}

/** Leads esperando resposta, com o prefixo do teste k (telefone +55 71 99741-k00i). */
async function leads(page: Page, k: number, n = 1, serie = 1) {
  const pre = `+55719974${serie}${k}`;
  await isola(pre);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    await simulate(page, { phone: `71 9974${serie}-${k}00${i + 1}`, name: NOMES[i], text: "Oi, vocês fazem progressiva?" });
    await e2eSql("update deals set awaiting_reply_since = now() - interval '6 minutes' where contact_id = (select id from contacts where phone_e164 = $1)", [`${pre}00${i + 1}`]);
    ids.push(await leadId(`${pre}00${i + 1}`));
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
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199741%' or phone_e164 like '+557199742%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});
const semPortal = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

test("triagem em massa: selecionar 3 e marcar como Não é cliente (no Mais), com Desfazer", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const ids = await leads(page, 1, 4);
  await page.goto("/atendimento");
  await expect(fila(page).getByRole("option")).toHaveCount(4);
  await expect(fila(page)).toHaveAttribute("aria-multiselectable", "true");

  await page.getByRole("button", { name: "Selecionar" }).click();
  const barra = barraMassa(page);
  await expect(barra).toContainText("Toque nas conversas para marcar");
  await expect(barra.getByRole("button", { name: "Resolver" })).toBeDisabled();
  for (const nome of NOMES.slice(0, 3)) await fila(page).getByRole("option", { name: new RegExp(nome) }).click();
  await expect(page).not.toHaveURL(/lead=/); // marcar não abre a conversa
  await expect(barra.getByTestId("selecionados")).toHaveText("3 marcadas");
  for (const nome of NOMES.slice(0, 3)) await expect(fila(page).getByRole("option", { name: new RegExp(nome) })).toHaveAttribute("aria-selected", "true");
  await expect(fila(page).getByRole("option", { name: new RegExp(NOMES[3]) })).toHaveAttribute("aria-selected", "false");
  // A barra (nova organização): Retomar, Passar para, Resolver e o "Mais" (Mover etapa e Não é cliente)
  await expect(barra.getByRole("button", { name: "Retomar" })).toBeVisible();
  await expect(barra.getByRole("button", { name: "Passar para" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
  await shot(page, "02-barra-massa-3-marcadas-desktop");

  await barra.getByRole("button", { name: "Mais ações para as marcadas" }).click();
  await page.getByRole("menuitem", { name: "Não é cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 marcadas como não é cliente" })).toBeVisible();
  await expect(fila(page).getByRole("option")).toHaveCount(1);
  await expect(barra).toHaveCount(0); // a seleção termina
  for (const id of ids.slice(0, 3)) expect((await deal(id)).archived_at).not.toBeNull();
  expect((await deal(ids[3])).archived_at).toBeNull();
  expect((await e2eSql("select count(*)::int as n from audit_log where action = 'arquivou_lead' and entity_id = any($1::text[])", [ids]))[0].n).toBe(3);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 voltaram" })).toBeVisible();
  await expect(fila(page).getByRole("option")).toHaveCount(4);
  for (const id of ids) expect((await deal(id)).archived_at).toBeNull();
  expect((await e2eSql("select count(*)::int as n from deal_events where type = 'restaurado' and deal_id = any($1::uuid[])", [ids]))[0].n).toBe(3);
  expect(erros, "erros do navegador").toEqual([]);
});

test("seleção por teclado: Espaço marca (sem abrir), Esc sai; Passar para e Mover etapa em massa; Resolver", async ({ page, isMobile }) => {
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
  await expect(page.getByTestId("selecionados")).toHaveText("2 marcadas");
  const anuncio = page.getByTestId("anuncio-selecao"); // região fixa para o leitor de tela
  await expect(anuncio).toHaveAttribute("role", "status");
  await expect(anuncio).toHaveAttribute("aria-live", "polite");
  await expect(anuncio).toHaveText("2 marcadas");
  await page.keyboard.press("Space"); // desmarca
  await expect(page.getByTestId("selecionados")).toHaveText("1 marcada");
  await expect(anuncio).toHaveText("1 marcada");
  await page.keyboard.press("Escape");
  await expect(anuncio).toHaveText("Seleção desligada");
  await expect(barraMassa(page)).toHaveCount(0);
  await expect(primeiro).toHaveAttribute("aria-selected", "false");

  // Caixinha ao passar o mouse: marca sem abrir o lead
  await fila(page).getByRole("option").nth(1).hover();
  await page.getByTestId("item-selecionar").nth(1).click();
  await expect(page.getByTestId("selecionados")).toHaveText("1 marcada");
  await fila(page).getByRole("option").nth(2).click({ modifiers: ["Shift"] }); // intervalo
  await expect(page.getByTestId("selecionados")).toHaveText("2 marcadas");

  const barra = barraMassa(page);
  await barra.getByRole("button", { name: "Passar para" }).click();
  const passar = page.getByRole("dialog", { name: "Passar 2 conversas para…" });
  await passar.getByRole("radio", { name: /Thaíse Fiaes/ }).click(); // as conversas novas nascem com a Ana
  await passar.getByRole("button", { name: "Passar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 conversas agora com Thaíse" })).toBeVisible();
  const donos = await e2eSql("select u.email from deals d join users u on u.id = d.owner_id where d.id = any($1::uuid[])", [ids]);
  expect(donos.filter((r) => r.email === "gestao@e2e.local")).toHaveLength(2);
  expect(donos.filter((r) => r.email === "ana@e2e.local")).toHaveLength(1);

  await page.getByRole("button", { name: "Selecionar" }).click();
  await fila(page).getByRole("option").nth(0).click();
  await fila(page).getByRole("option").nth(1).click();
  await barra.getByRole("button", { name: "Mais ações para as marcadas" }).click();
  await expect(page.getByRole("menuitem", { name: "Mover para Agendado" })).toHaveCount(0); // etapas que pedem dados ficam de fora
  await expect(page.getByRole("menuitem", { name: /Fechado|Aguardando cliente/ })).toHaveCount(0); // saíram do funil (16/10)
  await page.getByRole("menuitem", { name: "Mover para Orçamento" }).click();
  await expect(page.getByRole("status").filter({ hasText: /2 conversas movidas para Orçamento/ })).toBeVisible();
  const etapas = await e2eSql("select s.key from deals d join stages s on s.id = d.stage_id where d.id = any($1::uuid[])", [ids]);
  expect(etapas.filter((r) => r.key === "orcamento")).toHaveLength(2);

  // Resolver em massa: saem da lista e vão para Resolvidas
  await page.getByRole("button", { name: "Selecionar" }).click();
  await fila(page).getByRole("option").nth(0).click();
  await fila(page).getByRole("option").nth(1).click();
  await barra.getByRole("button", { name: "Resolver" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 conversas resolvidas" })).toBeVisible();
  await expect.poll(async () => (await e2eSql("select count(*)::int as n from deals where id = any($1::uuid[]) and conversation_archived_at is not null", [ids]))[0].n).toBe(2);
});

test("Passar para em massa segue a permissão de transferir: atendente e Recepção veem (pedido da Casa); perfil sem transferir, não", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [id] = await leads(page, 3, 1);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.context().clearCookies();
  await login(page, "ana@e2e.local");
  const barraDa = async () => {
    await page.goto("/atendimento");
    await page.getByRole("button", { name: "Selecionar" }).click();
    await fila(page).getByRole("option").first().click();
    return barraMassa(page);
  };
  let barra = await barraDa();
  await expect(barra.getByRole("button", { name: "Resolver" })).toBeEnabled();
  await expect(barra.getByRole("button", { name: "Mais ações para as marcadas" })).toBeVisible();
  await expect(barra.getByRole("button", { name: "Passar para" })).toBeVisible();
  await e2eSql("update users set profile_id = (select id from profiles where key = 'recepcao') where email = 'ana@e2e.local'");
  await e2eSql("insert into profiles (name, permissions, is_system) values ('Sem transferir e2e', '{atendimento.ver}', false) on conflict do nothing");
  try {
    barra = await barraDa();
    await expect(barra.getByRole("button", { name: "Passar para" })).toBeVisible();
    await e2eSql("update users set profile_id = (select id from profiles where name = 'Sem transferir e2e') where email = 'ana@e2e.local'");
    barra = await barraDa();
    await expect(barra.getByRole("button", { name: "Retomar" })).toBeVisible();
    await expect(barra.getByRole("button", { name: "Passar para" })).toHaveCount(0);
  } finally {
    await e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = 'ana@e2e.local'");
    await e2eSql("delete from profiles where name = 'Sem transferir e2e'");
  }
});

test("Retomar…: lembrete (motivo e quando, para quem cuida), Trocar substitui e Feito conclui com 1 toque", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const [id] = await leads(page, 4, 1);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  await expect(page.getByRole("region", { name: /Conversa com Bianca Teles/ }).getByRole("heading", { name: "Bianca Teles" })).toBeVisible();

  // data passada: erro, nada grava
  let dlg = await retomar(page, p, { motivo: "Mandar os valores", dias: -2 });
  await dlg.getByRole("button", { name: "Salvar lembrete" }).click();
  await expect(dlg.getByRole("alert")).toContainText("já passou");
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(0);
  await dlg.getByLabel("Dia").fill(diaBahia(3));
  await expect(dlg.getByRole("status")).toContainText("Lembrete para você");
  await dlg.getByRole("button", { name: "Salvar lembrete" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lembrete salvo" })).toBeVisible();

  const card = p.getByTestId("cartao-retomada");
  await expect(card).toContainText("Mandar os valores. Vira lembrete para você. Com Ana.");
  const [t] = await e2eSql("select t.*, u.email from tasks t join users u on u.id = t.assignee_id where t.deal_id = $1 and t.kind = 'proxima_acao' and t.done_at is null", [id]);
  expect(t.title).toBe("Mandar os valores");
  expect(t.email).toBe("ana@e2e.local"); // padrão: quem cuida
  expect(new Date(t.due_at as string).getTime()).toBeGreaterThan(Date.now());
  // a conversa passa a esperar a cliente (as tentativas correm em Em conversa)
  expect((await deal(id)).stage_key).toBe("atendimento");

  // Trocar: a nova substitui a atual (uma por conversa) e a antiga fica cancelada no histórico
  await card.getByRole("button", { name: "Trocar" }).click();
  dlg = page.getByRole("dialog", { name: /^Retomar/ });
  await expect(dlg.getByPlaceholder("Ex.: ver se fechou o orçamento")).toHaveValue("Mandar os valores");
  await dlg.getByPlaceholder("Ex.: ver se fechou o orçamento").fill("Ligar para confirmar");
  await dlg.getByRole("button", { name: "Salvar lembrete" }).click();
  await expect(card).toContainText("Ligar para confirmar");
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(1);
  expect((await e2eSql("select payload from deal_events where deal_id = $1 and type = 'tarefa' and payload->>'acao' = 'cancelada'", [id]))).toHaveLength(1);

  // Feito com 1 toque
  await card.getByRole("button", { name: "Feito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Retomada feita" })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(0);
  expect(await e2eSql("select 1 from deal_events where deal_id = $1 and type = 'tarefa' and payload->>'acao' = 'concluida' and payload->>'titulo' = 'Ligar para confirmar'", [id])).toHaveLength(1);
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
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).not.toContainText("Não identificada"); // origem desconhecida não aparece na linha
  for (const o of ["Indicação", "Instagram", "Google", "Passou na frente", "Outra"]) await expect(card.getByRole("button", { name: o, exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "WhatsApp" })).toHaveCount(0); // canal não é origem

  await card.getByRole("button", { name: "Instagram", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Origem salva" })).toBeVisible();
  await expect(p.getByTestId("como-conheceu")).toHaveCount(0);
  await p.getByRole("tab", { name: "Cliente" }).click(); // respondida, vai para a aba Cliente
  await expect(p.getByRole("region", { name: "Dados da cliente" }).getByRole("term").filter({ hasText: "Como conheceu" })).toBeVisible();
  await expect(p.getByRole("region", { name: "Dados da cliente" })).toContainText("Instagram");
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).not.toContainText("Instagram"); // cartão fino (16/10): origem só no painel
  await expect.poll(async () => (await deal(a)).source_label).toBe("Instagram");
  const ev = await e2eSql("select payload from deal_events where deal_id = $1 and type = 'campo_alterado'", [a]);
  expect(ev.at(-1)?.payload).toMatchObject({ campos: [{ campo: "origin", para: "Instagram" }] }); // o de/para no histórico

  // Outra: texto livre
  await page.goto(`/atendimento?lead=${b}`);
  const card2 = painel(page).getByTestId("como-conheceu");
  await card2.getByRole("button", { name: "Outra", exact: true }).click();
  await card2.getByRole("button", { name: "Salvar" }).click();
  await expect(card2.getByRole("alert")).toContainText("Escreva como a cliente conheceu a Casa.");
  await card2.getByLabel("Como a cliente conheceu a Casa").fill("Vizinha do salão");
  await card2.getByLabel("Como a cliente conheceu a Casa").press("Enter");
  await expect(page.getByRole("option", { name: /Carla Mendes/ })).not.toContainText("Vizinha do salão"); // cartão fino (16/10): origem só no painel
  await expect.poll(async () => (await deal(b)).source_label).toBe("Vizinha do salão");
});

test("Compareceu/Faltou: na Fila (conferir) e no painel; Faltou cria a retomada Remarcar; Compareceu vai para Atendida com o pós-atendimento", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const [a, b] = await leads(page, 6, 2);
  for (const id of [a, b]) {
    await noEstagio(id, "agendado");
    await e2eSql("update deals set scheduled_at = now() - interval '2 hours', awaiting_reply_since = null, owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  }
  await page.goto("/atendimento");
  const conferir = page.getByRole("region", { name: "Ela veio?" });
  const abre = conferir.getByRole("button", { name: /Ela veio\?/ });
  if ((await abre.getAttribute("aria-expanded")) !== "true") await abre.click(); // começa aberta
  await expect(conferir.getByTestId("conferir-item")).toHaveCount(2);
  await expect(conferir).toContainText("Bianca Teles");

  // botões ficam fora do listbox (nada interativo dentro de uma option)
  expect(await fila(page).getByRole("button").count()).toBe(0);

  await conferir.getByRole("button", { name: "Faltou: Bianca Teles" }).click();
  // QA r58 (M-2): Faltou pede confirmação.
  await page.getByRole("dialog", { name: "O que aconteceu?" }).getByRole("button", { name: "Marcar que não veio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bianca Teles faltou · combinado: Remarcar" })).toBeVisible();
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
  await expect(p.getByTestId("cartao-retomada")).toContainText("Remarcar com Bianca Teles");
  expect((await deal(a)).stage_key).toBe("atendimento"); // Faltou: Em conversa esperando a cliente (sem Aguardando cliente)

  // Corrigiu: Faltou → Compareceu cancela o Remarcar que o Faltou criou; a conversa vai para Atendida com o pós-atendimento (Lote 1C)
  await p.getByRole("button", { name: "Veio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bianca Teles veio" })).toBeVisible();
  await expect(p.getByTestId("cartao-retomada")).toContainText("Pós-atendimento de Bianca: agradecer, pedir foto e avaliação");
  expect((await deal(a)).attendance).toBe("compareceu");
  expect((await deal(a)).stage_key).toBe("atendida");
  expect((await e2eSql("select title from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [a])).map((t) => t.title)).toEqual(["Pós-atendimento de Bianca: agradecer, pedir foto e avaliação"]);
  expect(await e2eSql("select 1 from deal_events where deal_id = $1 and type = 'tarefa' and payload->>'acao' = 'cancelada' and payload->>'titulo' = 'Remarcar com Bianca Teles'", [a])).toHaveLength(1);

  await page.goto(`/atendimento?lead=${b}`);
  await painel(page).getByRole("button", { name: "Veio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Carla Mendes veio" })).toBeVisible();
  await expect(painel(page).getByRole("button", { name: "Veio" })).toHaveAttribute("aria-pressed", "true");
  expect((await deal(b)).attendance).toBe("compareceu");
  // compareceu abre o pós-atendimento (Lote 1C): agradecer, pedir foto e avaliação
  expect((await e2eSql("select title from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [b])).map((t) => t.title)).toEqual(["Pós-atendimento de Carla: agradecer, pedir foto e avaliação"]);
  await page.goto("/atendimento");
  await expect(page.getByRole("region", { name: "Ela veio?" })).toHaveCount(0); // nada mais a conferir
  expect(erros, "erros do navegador").toEqual([]);
});

test("atendente age na conversa de outra pessoa (salão compartilhado): Retomar, Compareceu e Não é cliente individual", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [a, b] = await leads(page, 4, 2, 2);
  for (const id of [a, b]) await e2eSql("update deals set owner_id = (select id from users where email = 'gestao@e2e.local') where id = $1", [id]);
  await noEstagio(a, "agendado");
  await e2eSql("update deals set scheduled_at = now() - interval '1 hour' where id = $1", [a]);
  await page.context().clearCookies();
  await login(page, "ana@e2e.local");
  await page.goto(`/atendimento/${a}`);
  const p = painel(page);
  await expect(page.getByRole("region", { name: /^Conversa com / }).getByTestId("dona")).toHaveText("Com: Thaíse"); // quem cuida fica no cabeçalho
  const dlg = await retomar(page, p, { motivo: "Confirmar com a cliente" });
  await dlg.getByRole("button", { name: "Salvar lembrete" }).click();
  await expect(p.getByTestId("cartao-retomada")).toContainText("Confirmar com a cliente");
  await p.getByRole("button", { name: "Veio" }).click();
  await expect(p.getByRole("button", { name: "Veio" })).toHaveAttribute("aria-pressed", "true");
  expect((await deal(a)).attendance).toBe("compareceu");
  // Como conheceu? e Não é cliente, também no lead de outra pessoa
  await page.goto(`/atendimento/${b}`);
  await painel(page).getByTestId("como-conheceu").getByRole("button", { name: "Google", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Origem salva" })).toBeVisible();
  expect((await deal(b)).source_label).toBe("Google");
  await page.getByRole("button", { name: "Mais ações" }).first().click();
  await page.getByRole("menuitem", { name: /Marcar como spam/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "saiu da lista" })).toBeVisible();
  expect((await deal(b)).archived_at).not.toBeNull();
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect.poll(async () => (await deal(b)).archived_at).toBeNull();
});

test("Retomar com a Casa fechada no horário: a mensagem programada sai do mesmo jeito (16/10) e o cartão mostra a retomada", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const [id] = await leads(page, 5, 1, 2);
  const original = (await e2eSql("select value from settings where key = 'business_hours'"))[0].value;
  try {
    const curto = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ["08:00", "09:00"]]));
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(curto)]);
    await page.goto(`/atendimento?lead=${id}`);
    const dlg = await retomar(page, painel(page), { motivo: "Ligar à tarde", dias: 1, hora: "15:00", texto: "Oi! Posso te ligar à tarde?" });
    await dlg.getByRole("button", { name: "Programar" }).click();
    await expect(dlg).toBeHidden();
    await expect.poll(async () => (await e2eSql("select 1 from outbox where deal_id = $1 and status = 'pending'", [id])).length).toBe(1);
    expect(await e2eSql("select 1 from tasks where deal_id = $1 and kind = 'proxima_acao' and done_at is null", [id])).toHaveLength(1);
    await expect(painel(page).getByTestId("cartao-retomada")).toBeVisible();
  } finally {
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(original)]);
  }
});

test.describe("celular: triagem em massa e Retomar em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });

  test("Selecionar no topo da Fila, 3 marcadas, barra em alvos de 44 px e Não é cliente com Desfazer", async ({ page, isMobile }) => {
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
    const barra = barraMassa(page);
    await expect(barra.getByTestId("selecionados")).toHaveText("3 marcadas");
    for (const b of await barra.getByRole("button").all()) expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(43.9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await semPortal(page);
    await shot(page, "03-celular-selecao-3-marcados-390", { clip: { x: 0, y: 0, width: 390, height: 700 } });
    // O "Mais" (Mover etapa, Não é cliente) abre para cima e cabe na tela
    await barra.getByRole("button", { name: "Mais ações para as marcadas" }).click();
    const menu = page.getByRole("menu", { name: "Mais ações para as marcadas" });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.getByRole("menuitem", { name: "Não é cliente" }).click();
    await expect(page.getByRole("status").filter({ hasText: "3 marcadas como não é cliente" })).toBeVisible();
    await expect(fila(page).getByRole("option")).toHaveCount(1);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(fila(page).getByRole("option")).toHaveCount(4);
    for (const id of ids) expect((await deal(id)).archived_at).toBeNull();
    expect(erros, "erros do navegador").toEqual([]);
  });

  test("ⓘ Cliente: Compareceu/Faltou, Retomar e Como conheceu? com alvos de 44 px e campos de 16 px; Faltou não sobrescreve a retomada", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const [id] = await leads(page, 9, 1);
    await noEstagio(id, "agendado");
    await e2eSql("update deals set scheduled_at = now() - interval '1 hour' where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
    await lead.getByRole("button", { name: "Ver dados da cliente" }).click();
    const p = page.getByRole("dialog", { name: "Bianca Teles" });
    for (const alvo of [p.getByRole("button", { name: "Veio" }), p.getByRole("button", { name: "Faltou" }), p.getByRole("button", { name: "Retomar…" }), p.getByTestId("como-conheceu").getByRole("button", { name: "Instagram", exact: true }), p.getByTestId("como-conheceu").getByRole("button", { name: "Outra", exact: true })]) {
      expect((await alvo.boundingBox())!.height, await alvo.innerText()).toBeGreaterThanOrEqual(43.9);
    }
    const dlg = await retomar(page, p, { motivo: "Mandar os valores" });
    for (const campo of [dlg.getByPlaceholder("Ex.: ver se fechou o orçamento"), dlg.getByLabel("Dia"), dlg.getByLabel("Hora"), dlg.getByLabel("Mensagem (opcional)")]) {
      expect(await campo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), "fonte do campo").toBeGreaterThanOrEqual(16);
    }
    for (const chip of await dlg.getByRole("radio").all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await semPortal(page);
    await shot(page, "04-celular-retomar-390");
    await dlg.getByRole("button", { name: "Salvar lembrete" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Lembrete salvo" })).toBeVisible();
    await expect(p.getByTestId("cartao-retomada")).toContainText("Mandar os valores");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.getByRole("button", { name: "Faltou" }).click();
    await page.getByRole("dialog", { name: "O que aconteceu?" }).getByRole("button", { name: "Marcar que não veio" }).click();
    await expect(p.getByRole("button", { name: "Faltou" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "o combinado que já existia foi mantido" })).toBeVisible();
    await expect(p.getByTestId("cartao-retomada")).toContainText("Mandar os valores"); // o plano da atendente não é sobrescrito
  });
});
