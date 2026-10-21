import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot, isola } from "./helpers";

// Lote 6B: no modo "consulta" (o de produção até o dono escolher), "Agendar horário" na conversa continua a folha antiga (decisão 2 do plano).
test.beforeAll(async () => { await e2eSql(`insert into settings (key, value) values ('agenda_modo', '"consulta"') on conflict (key) do update set value = excluded.value`); });
test.afterAll(async () => { await e2eSql(`update settings set value = '"dupla"' where key = 'agenda_modo'`); });

const leadId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 order by d.created_at desc limit 1", [phone]))[0].id);
const deal = async (id: string) => (await e2eSql(`select d.*, s.key as stage_key, u.email as owner_email from deals d join stages s on s.id = d.stage_id left join users u on u.id = d.owner_id where d.id = $1`, [id]))[0];
const eventos = async (id: string, type: string) => e2eSql("select payload, user_id from deal_events where deal_id = $1 and type = $2 order by created_at", [id, type]);
const noEstagio = (id: string, key: string) => e2eSql("update deals set stage_id = (select id from stages where key = $2), stage_entered_at = now() where id = $1", [id, key]);

/** Um lead esperando resposta, no prefixo do teste k. */
async function umLead(page: Page, k: number, nome = "Bianca Teles") {
  await isola(`+557199740${k}`);
  await simulate(page, { phone: `71 99740-${k}001`, name: nome, text: "Oi, vocês fazem progressiva?" });
  await e2eSql("update deals set awaiting_reply_since = now() - interval '6 minutes' where contact_id = (select id from contacts where phone_e164 = $1)", [`+557199740${k}001`]);
  return leadId(`+557199740${k}001`);
}

function errosDoNavegador(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  return erros;
}

const painel = (page: Page) => page.getByRole("region", { name: "Dados do cliente" });
/** Dia (AAAA-MM-DD) de Salvador, `dias` depois de hoje. */
const diaBahia = (dias: number) => new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

test("painel da cliente (1366x768): cabeçalho em 2 linhas e as abas Agora/Cliente sem rolar; nada de Fechar venda, Não é cliente solto ou PRÓXIMA AÇÃO", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page);
  const id = await umLead(page, 1);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  const cab = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
  await expect(cab.getByRole("heading", { name: "Bianca Teles" })).toBeVisible();
  // Linha 2 do cabeçalho: etapa ▾, status ▾, "Com:" ▾ e Assumir
  const faixa = cab.getByTestId("faixa-conversa");
  await expect(faixa.getByRole("button", { name: /^Trocar etapa: Novo contato/ })).toBeVisible();
  await expect(faixa.getByTestId("status-conversa")).toHaveAttribute("data-status", "aberto"); // o texto vira "Atrasado" se o prazo já passou
  await expect(faixa.getByRole("button", { name: /Passar para…$/ })).toBeVisible();
  await expect(faixa.getByRole("button", { name: "Assumir", exact: true })).toBeVisible();
  // Agora: a situação numa frase, o próximo passo e os 3 botões
  await expect(p.getByRole("tab", { name: "Agora" })).toHaveAttribute("aria-selected", "true");
  await expect(p.getByTestId("situacao-conversa")).toContainText(/Esperando a Casa · Passou \d+ min do prazo/);
  await expect(p.getByRole("region", { name: "O que fazer" }).getByRole("button")).toHaveText(["Agendar horário", "Retomar…", "R$Mandar orçamento"]);
  for (const t of ["Fechar venda", "Não é cliente", "PRÓXIMA AÇÃO", "Próxima ação"]) await expect(p.getByText(t, { exact: true })).toHaveCount(0);
  const semRolar = async () => p.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(await semRolar(), "aba Agora cabe sem rolar").toBe(true);
  await p.getByRole("tab", { name: "Cliente" }).click();
  await expect(p.getByRole("region", { name: "Dados da cliente" })).toBeVisible();
  expect(await semRolar(), "aba Cliente cabe sem rolar").toBe(true);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
  await shot(page, "01-painel-desktop-1366");
  expect(erros, "erros do navegador").toEqual([]);
});

test("etapas pelo cabeçalho: muda com auditoria; Na Casa aparece; Fechado e Aguardando cliente não; Agendado e Perdido abrem a folha", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 2);
  await page.goto(`/atendimento?lead=${id}`);
  const cab = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
  await cab.getByRole("button", { name: /^Trocar etapa/ }).click();
  const menu = page.getByRole("menu", { name: /^Trocar etapa/ });
  await expect(menu.getByRole("menuitem")).toHaveText(["Em conversa", "Orçamento", "Agendado", "Na Casa", "Atendida", "Hora de voltar", "Perdido"]);
  await menu.getByRole("menuitem", { name: "Em conversa" }).click();
  await expect.poll(async () => (await deal(id)).stage_key).toBe("atendimento");
  const mov = await eventos(id, "etapa_alterada");
  expect(mov.at(-1)?.payload).toMatchObject({ de: "lead", para: "atendimento", motivo: "manual" });
  for (const [etapa, folha] of [["Agendado", "Agendar avaliação"], ["Perdido", "Marcar como perdido"]] as const) {
    await cab.getByRole("button", { name: /^Trocar etapa/ }).click();
    await page.getByRole("menuitem", { name: etapa }).click();
    const dlg = page.getByRole("dialog", { name: folha });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    await expect(dlg).toHaveCount(0);
    expect((await deal(id)).stage_key).toBe("atendimento");
  }
});

test("Mandar orçamento: o valor vira mensagem NO CAMPO (nada é enviado), a etapa vai para Orçamento e o Desfazer volta", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 3);
  await noEstagio(id, "atendimento");
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: /Mandar orçamento/ }).click();
  const dlg = page.getByRole("dialog", { name: "Mandar orçamento" });
  await dlg.getByRole("radio", { name: "Coloração" }).click();
  await dlg.getByLabel("Valor (R$)").fill("380");
  await expect(dlg.getByTestId("orcamento-previa")).toHaveText("Oi, Bianca! Coloração fica R$ 380,00. Quer que eu veja um horário para você?");
  await dlg.getByRole("button", { name: "Colocar no campo" }).click();
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Oi, Bianca! Coloração fica R$ 380,00. Quer que eu veja um horário para você?");
  await expect.poll(async () => (await deal(id)).stage_key).toBe("orcamento");
  expect((await e2eSql("select count(*)::int as n from messages m join deals d on d.id = m.deal_id where d.id = $1 and m.direction = 'out'", [id]))[0].n).toBe(0);
  await page.getByRole("status").filter({ hasText: "Etapa → Orçamento" }).getByRole("button", { name: "Desfazer" }).click();
  await expect.poll(async () => (await deal(id)).stage_key).toBe("atendimento");
});

test("Retomar…: uma ação só; com mensagem, ela fica programada ligada à retomada; o cartão do próximo passo tem Feito e Trocar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 4);
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: "Retomar…" }).click();
  const dlg = page.getByRole("dialog", { name: /^Retomar Bianca/ });
  await dlg.getByRole("radio", { name: "Escolher" }).click();
  await dlg.getByLabel("Dia").fill(diaBahia(2));
  await dlg.getByLabel("Hora").fill("10:00");
  await dlg.getByPlaceholder("Ex.: ver se fechou o orçamento").fill("Ver se ela decidiu");
  await dlg.getByLabel("Mensagem (opcional)").fill("Oi, Bianca! Conseguiu ver os horários?");
  await expect(dlg.getByRole("switch", { name: "Cancelar se ela responder antes" })).toHaveAttribute("aria-checked", "true");
  await dlg.getByRole("button", { name: "Programar" }).click();
  // A Casa pode estar fechada no dia escolhido: aí o diálogo explica e não grava nada.
  const fechada = dlg.getByRole("alert").filter({ hasText: "fechada" });
  if (await fechada.isVisible().catch(() => false)) return;
  await expect(page.getByRole("status").filter({ hasText: "Mensagem programada" })).toBeVisible();
  const [o] = await e2eSql("select o.options->>'taskId' as task, t.title from outbox o join tasks t on t.id::text = o.options->>'taskId' where o.deal_id = $1 and o.status = 'pending'", [id]);
  expect(o.title).toBe("Ver se ela decidiu");
  const card = painel(page).getByTestId("cartao-retomada");
  await expect(card).toContainText("Mensagem sai");
  await expect(page.getByRole("group", { name: "Mensagem programada" })).toContainText("Conseguiu ver os horários?");
  await card.getByRole("button", { name: "Feito" }).click();
  await expect.poll(async () => (await e2eSql("select count(*)::int as n from outbox where deal_id = $1 and status = 'pending'", [id]))[0].n).toBe(0);
});

test("Editar dados: todos os campos num lugar; alergia vira aviso fixo; CPF conferido e visível para a equipe", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 9);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  await p.getByRole("tab", { name: "Cliente" }).click();
  await p.getByRole("button", { name: "Editar dados" }).click();
  const dlg = page.getByRole("dialog", { name: /^Dados de Bianca/ });
  for (const l of ["Nome", "Como ela gosta de ser chamada", "WhatsApp", "Outro telefone (opcional)", "Aniversário", "E-mail", "Instagram", "Profissional preferida", "Tipo de cabelo", "CPF (opcional)", "Alergias e cuidados", "Observações"]) {
    await expect(dlg.getByText(l, { exact: true }).first()).toBeVisible(); // "Instagram" também é opção de "Como conheceu a Casa"
  }
  await dlg.getByLabel("Como ela gosta de ser chamada").fill("Bia");
  await dlg.getByLabel("Instagram").fill("@bianca.ficticia");
  await dlg.getByLabel("Alergias e cuidados").fill("Alergia a amônia");
  await dlg.getByLabel("CPF (opcional)").fill("111.111.111-11");
  await dlg.getByRole("button", { name: "Salvar dados" }).click();
  await expect(dlg.getByRole("alert")).toContainText("CPF inválido");
  await dlg.getByLabel("CPF (opcional)").fill("529.982.247-25");
  await dlg.getByRole("button", { name: "Salvar dados" }).click();
  await expect(dlg).toHaveCount(0);
  const [c] = await e2eSql("select nickname, instagram, alert_notes, cpf from contacts where phone_e164 = '+5571997409001'");
  expect(c).toMatchObject({ nickname: "Bia", instagram: "bianca.ficticia", alert_notes: "Alergia a amônia", cpf: "52998224725" });
  await expect(p.getByRole("list", { name: "Avisos fixos" })).toContainText("Alergia a amônia");
  await expect(p.getByRole("region", { name: "Dados da cliente" })).toContainText("529.982.247-25");
});

test("aba Serviços: cadastrar um serviço e ele aparece no Mandar orçamento", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const nome = "Serviço e2e novo";
  try {
    await login(page);
    await page.goto("/servicos");
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await page.getByRole("dialog", { name: "Novo serviço" }).getByLabel("Nome").fill(nome);
    await page.getByRole("button", { name: "Criar serviço" }).click();
    await expect.poll(async () => (await e2eSql("select count(*)::int as n from lists where kind = 'service' and label = $1 and active", [nome]))[0].n).toBe(1);
    const id = await umLead(page, 6);
    await page.goto(`/atendimento?lead=${id}`);
    await painel(page).getByRole("button", { name: /Mandar orçamento/ }).click();
    await expect(page.getByRole("dialog", { name: "Mandar orçamento" }).getByRole("radio", { name: nome })).toBeVisible();
  } finally {
    await e2eSql("delete from lists where kind = 'service' and label = $1", [nome]);
  }
});

test("Marcar como spam (no ⋯) tira da lista e o Desfazer devolve a conversa", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 5);
  await page.goto(`/atendimento?lead=${id}`);
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toBeVisible();
  const naoCliente = async () => { await page.getByRole("button", { name: "Mais ações" }).first().click(); await page.getByRole("menuitem", { name: /Marcar como spam/ }).click(); };
  await naoCliente();

  await expect(page.getByRole("status").filter({ hasText: "Bianca Teles agora é Spam e saiu da lista" })).toBeVisible();
  await expect(page).not.toHaveURL(/lead=/);
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toHaveCount(0);
  expect((await deal(id)).archived_at).not.toBeNull();
  expect((await e2eSql("select ignored from contacts where phone_e164 = '+5571997405001'"))[0].ignored).toBe(true);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("region", { name: /Conversa com Bianca Teles/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toBeVisible();
  const d = await deal(id);
  expect(d.archived_at).toBeNull();
  expect(d.stage_key).toBe("lead");
  expect((await e2eSql("select ignored from contacts where phone_e164 = '+5571997405001'"))[0].ignored).toBe(false);
  expect((await eventos(id, "restaurado"))).toHaveLength(1);

  await expect(page.locator("button", { hasText: "Desfazer" })).toHaveCount(0); // o aviso do 1º Desfazer saiu do DOM de verdade (não só da árvore de acessibilidade)
  // Alguém já devolveu o lead antes do Desfazer: avisa e não tenta abrir
  await naoCliente();
  await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();
  await e2eSql("update deals set archived_at = null, archived_by = null, archived_stage_id = null where id = $1", [id]);
  await e2eSql("update contacts set ignored = false where phone_e164 = '+5571997405001'");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Essa conversa já tinha voltado" })).toBeVisible();
  await expect(page).not.toHaveURL(/lead=/);
});

test("Assumir troca a dona exibida no cabeçalho; a gestão transfere pela dona ▾; a atendente também (pedido da Casa)", async ({ page, browser, baseURL, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 6);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  const lead = (pg: Page) => pg.getByRole("region", { name: /^Conversa com / });
  const dono = lead(page).getByTestId("dona");
  await expect(dono).toHaveText("Com: Ana");

  await lead(page).getByRole("button", { name: "Assumir", exact: true }).click();
  await expect(dono).toHaveText("Com: Thaíse");
  await expect(lead(page).getByRole("button", { name: "Assumir", exact: true })).toHaveCount(0); // já é meu
  expect((await deal(id)).owner_email).toBe("gestao@e2e.local");
  const assumiu = await eventos(id, "assumiu");
  expect(assumiu).toHaveLength(1);
  expect(assumiu[0].payload).toMatchObject({ para: expect.any(String) });

  // A gestão passa para outra pessoa ("Com:" ▾ abre o Passar para…, com nota opcional)
  await lead(page).getByRole("button", { name: "Com Thaíse Fiaes. Passar para…" }).click();
  const passar = page.getByRole("dialog", { name: "Passar para…" });
  await passar.getByRole("radio", { name: /Ana Souza/ }).click();
  await passar.getByPlaceholder("Ex.: ela quer sábado de manhã").fill("ela quer sábado de manhã");
  await passar.getByRole("button", { name: "Passar" }).click();
  await expect(dono).toHaveText("Com: Ana");
  expect((await deal(id)).owner_email).toBe("ana@e2e.local");
  expect(await eventos(id, "responsavel_alterado")).toHaveLength(1);
  await expect.poll(async () => (await e2eSql("select body from contact_notes where deal_id = $1 order by created_at desc limit 1", [id]))[0]?.body).toBe("@Ana ela quer sábado de manhã");

  // Atendente: a conversa é de outra pessoa → Assumir; e, com o perfil padrão, também transfere
  await e2eSql("update deals set owner_id = (select id from users where email = 'gestao@e2e.local') where id = $1", [id]);
  const ctx = await browser.newContext({ baseURL, storageState: "e2e/.auth/ana.json" });
  const ana = await ctx.newPage();
  await ana.goto(`/atendimento/${id}`);
  await expect(lead(ana).getByTestId("dona")).toHaveText("Com: Thaíse");
  await expect(lead(ana).getByRole("button", { name: "Com Thaíse Fiaes. Passar para…" })).toBeVisible();
  await lead(ana).getByRole("button", { name: "Assumir", exact: true }).click();
  await expect(lead(ana).getByTestId("dona")).toHaveText("Com: Ana");
  expect((await deal(id)).owner_email).toBe("ana@e2e.local");
  await ctx.close();
});

test("agendar valida: horário passado é erro; fora do expediente avisa e deixa agendar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 7);
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: /^Agendar horário/ }).click();
  const dlg = page.getByRole("dialog", { name: "Agendar avaliação" });
  await expect(dlg).toBeVisible();

  // Passado: erro, e o botão não agenda
  await dlg.getByLabel("Dia").fill(diaBahia(-1));
  await dlg.getByLabel("Hora").fill("10:00");
  await expect(dlg.getByRole("alert")).toContainText("Esse horário já passou");
  await dlg.getByRole("button", { name: "Agendar", exact: true }).click();
  expect((await deal(id)).stage_key).toBe("lead");

  // Futuro dentro do expediente (o e2e abre 24 h): sem aviso
  await dlg.getByLabel("Dia").fill(diaBahia(1));
  await dlg.getByLabel("Hora").fill("10:00");
  await expect(dlg.getByRole("alert")).toHaveCount(0);
  await expect(dlg.getByRole("status")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Cancelar" }).click();

  // Expediente curto (8h-9h): 15:00 fica fora, avisa mas agenda
  const original = (await e2eSql("select value from settings where key = 'business_hours'"))[0].value;
  try {
    const curto = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ["08:00", "09:00"]]));
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(curto)]);
    await page.reload();
    await painel(page).getByRole("button", { name: /^Agendar horário/ }).click();
    const dlg2 = page.getByRole("dialog", { name: "Agendar avaliação" });
    await dlg2.getByLabel("Dia").fill(diaBahia(2));
    await dlg2.getByLabel("Hora").fill("15:00");
    await expect(dlg2.getByRole("status")).toContainText(/Fora do horário de atendimento \(\p{L}+, das 8:00 às 9:00\)\. Dá para agendar mesmo assim\./u);
    await shot(page, "03-agendar-fora-do-horario-desktop");
    await dlg2.getByRole("button", { name: "Agendar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Horário marcado" })).toBeVisible();
    const d = await deal(id);
    expect(d.stage_key).toBe("agendado");
    expect(new Date(d.scheduled_at as string).toISOString()).toBe(new Date(`${diaBahia(2)}T15:00:00-03:00`).toISOString());
    await expect(painel(page).getByTestId("cartao-horario")).toContainText(/15:00/); // "sáb 18/10 15:00"
    // Remarcar fica só em "O que fazer" (um caminho só; no cartão ele saía do painel).
    await expect(painel(page).getByTestId("cartao-horario").getByRole("button", { name: "Remarcar" })).toHaveCount(0);
    await expect(painel(page).getByRole("button", { name: "Remarcar horário" })).toBeVisible();
  } finally {
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(original)]);
  }
});

test("perdido pede o motivo", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 8);
  await page.goto(`/atendimento?lead=${id}`);
  await page.getByRole("button", { name: "Mais ações" }).first().click();
  await page.getByRole("menuitem", { name: "Marcar como perdido" }).click();
  const dlg = page.getByRole("dialog", { name: "Marcar como perdido" });
  await dlg.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Escolha o motivo da perda.");
  expect((await deal(id)).stage_key).toBe("lead");

  await dlg.getByRole("radio", { name: "Preço" }).click();
  await dlg.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marcada como perdido" })).toBeVisible();
  const d = await deal(id);
  expect(d.stage_key).toBe("perdido");
  expect(String((await e2eSql("select label from lists where id = $1", [d.lost_reason_id]))[0].label)).toBe("Preço");
  await expect(painel(page).getByText("Perdido · Preço")).toBeVisible();
  // Auditoria de/para do motivo
  const campos = (await eventos(id, "campo_alterado")).flatMap((e) => (e.payload as { campos: { campo: string; de: unknown; para: unknown }[] }).campos);
  expect(campos).toContainEqual(expect.objectContaining({ campo: "lostReasonId", de: null, para: d.lost_reason_id }));
});

test.describe("celular: conversa e painel da cliente em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });

  test("ⓘ Cliente abre o painel em tela cheia (Agora/Cliente), alvos de 44 px e nada rola para o lado; o [+] guarda respostas e nota", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const erros = errosDoNavegador(page);
    await login(page);
    const id = await umLead(page, 1);
    await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" }); // o selo do dev cobre o [+] do compositor em 390 px
    const lead = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
    await expect(lead).toBeVisible();
    // Faixa fina embaixo do nome: etapa, status, com quem está e Assumir
    const faixa = lead.getByTestId("faixa-conversa");
    await expect(faixa.getByTestId("status-conversa")).toBeVisible();
    await expect(faixa.getByRole("button", { name: "Assumir", exact: true })).toBeVisible();
    // Compositor: [+] com anexar, respostas e nota; o relógio "Programar mensagem" à vista
    await expect(page.getByRole("button", { name: "Programar mensagem" })).toBeVisible();
    await page.getByRole("button", { name: "Anexar e mais" }).click();
    for (const i of ["Foto ou arquivo", "Respostas prontas", "Nota para a equipe"]) await expect(page.getByRole("menuitem", { name: i })).toBeVisible();
    await page.keyboard.press("Escape");
    await lead.getByRole("button", { name: "Ver dados da cliente" }).click();
    const sheet = page.getByRole("dialog", { name: "Bianca Teles" });
    await expect(sheet.getByRole("tab", { name: "Agora" })).toHaveAttribute("aria-selected", "true");
    for (const alvo of [sheet.getByRole("button", { name: "Agendar horário" }), sheet.getByRole("button", { name: "Retomar…" }), sheet.getByRole("button", { name: /Mandar orçamento/ }), sheet.getByRole("tab", { name: "Cliente" })]) {
      expect((await alvo.boundingBox())!.height, await alvo.innerText()).toBeGreaterThanOrEqual(43.9);
    }
    await sheet.getByRole("tab", { name: "Cliente" }).click();
    await expect(sheet.getByRole("region", { name: "Dados da cliente" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await shot(page, "04-celular-cliente-390");
    expect(erros, "erros do navegador").toEqual([]);
  });

  test("o ⋯ do cabeçalho tem o contato e o raro (Editar dados, Perdido, Marcar como…); Assumir fica na faixa", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const id = await umLead(page, 2);
    await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
    await lead.getByTestId("faixa-conversa").getByRole("button", { name: "Assumir", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Agora a conversa é sua" })).toBeVisible();
    await expect.poll(async () => (await deal(id)).owner_email).toBe("gestao@e2e.local");
    await lead.getByRole("button", { name: "Mais ações", exact: true }).click();
    for (const item of ["Ligar", "WhatsApp", "Editar dados da cliente", "Marcar como perdido", "Marcar como fornecedor", "Marcar como spam"]) await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Fechar venda" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Marcar como perdido" }).click();
    await expect(page.getByRole("dialog", { name: "Marcar como perdido" })).toBeVisible();
  });

  test("WhatsApp caído: aviso compacto no cabeçalho da conversa, com link para resolver", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const id = await umLead(page, 3);
    await e2eSql("insert into channels (name, instance_name, status) values ('Salão', 'e2e-aviso-celular', 'erro')");
    try {
      await page.goto(`/atendimento/${id}`);
      const lead = page.getByRole("region", { name: /Conversa com Bianca Teles/ });
      const aviso = lead.getByTestId("aviso-whatsapp");
      await expect(aviso).toContainText("WhatsApp desconectado");
      await expect(aviso).toHaveAttribute("href", "/config/whatsapp"); // gestão: vai para reconectar
      await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
      await shot(page, "06-celular-whatsapp-caido-390", { clip: { x: 0, y: 0, width: 390, height: 260 } });
      expect((await aviso.boundingBox())!.height).toBeLessThanOrEqual(40); // compacto: uma linha só
      // O cabeçalho continua compacto e nada rola para o lado
      const voltar = await lead.getByRole("link", { name: "Voltar para a fila" }).boundingBox();
      const mais = await lead.getByRole("button", { name: "Mais ações", exact: true }).boundingBox();
      expect(Math.abs((voltar!.y + voltar!.height / 2) - (mais!.y + mais!.height / 2))).toBeLessThan(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      // O alvo de toque tem 44 px (a área clicável passa do texto)
      const alvo = await aviso.evaluate((el) => { const r = getComputedStyle(el, "::before"); return parseFloat(r.height) || 0; });
      expect(alvo).toBeGreaterThanOrEqual(43.9);
      // Canal removido: o aviso some
      await e2eSql("update channels set name = 'Salão (removido)' where instance_name = 'e2e-aviso-celular'");
      await page.reload();
      await expect(lead.getByTestId("aviso-whatsapp")).toHaveCount(0);
    } finally {
      // Não deixa canal para trás: o simulador ligaria os próximos leads a ele e o envio falharia.
      await e2eSql("delete from channels where instance_name = 'e2e-aviso-celular'");
    }
  });
});

test("item 6 (17/10): cancelar o horário pela conversa, com motivo, e 'Lembrar de remarcar' abre o Retomar com a data e a mensagem", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  // Número próprio (o prefixo 8 do umLead já é de outro teste).
  await isola("+5571997410");
  await simulate(page, { phone: "71 99741-0001", name: "Elza Cancela", text: "Oi, preciso cancelar meu horário" });
  const id = await leadId("+5571997410001");
  const [{ contact_id: contactId }] = await e2eSql("select contact_id from deals where id = $1", [id]);
  const [a] = await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key)
    values ($1, 'Elza Cancela', (select id from professionals where name = 'Maiara'), 'Corte', $2, 60, 'agendado', 'crm', 'e2e:' || gen_random_uuid()) returning id`,
    [contactId, new Date(`${diaBahia(2)}T10:00:00-03:00`).toISOString()]);
  await page.goto(`/atendimento?lead=${id}`);
  const card = painel(page).getByTestId("cartao-horario");
  await card.getByRole("button", { name: "Ver a visita" }).click();
  const visita = page.getByRole("dialog", { name: "Elza Cancela" });
  await expect(visita.getByTestId("visita-servico")).toHaveCount(1);
  await visita.getByRole("button", { name: "Fechar" }).first().click();
  await card.getByRole("button", { name: "Cancelar horário" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar horário" });
  await cancel.getByRole("radio", { name: "A cliente desmarcou" }).click();
  await cancel.getByRole("button", { name: "Cancelar horário" }).click();
  await expect.poll(async () => (await e2eSql("select status, cancel_reason from appointments where id = $1", [a.id]))[0]).toEqual({ status: "cancelado", cancel_reason: "cliente_desmarcou" });
  const lembrar = page.getByRole("dialog", { name: "Lembrar de remarcar?" });
  await lembrar.getByRole("button", { name: "Daqui a 30 dias" }).click();
  const dlg = page.getByRole("dialog", { name: /^Retomar Elza/ });
  await expect(dlg.getByLabel("Mensagem (opcional)")).toHaveValue(/^Oi, Elza! .*remarcar seu horário/);
  await dlg.getByRole("button", { name: "Programar" }).click();
  const fechada = dlg.getByRole("alert").filter({ hasText: "fechada" });
  if (await fechada.isVisible().catch(() => false)) return;
  await expect(page.getByRole("status").filter({ hasText: "Mensagem programada" })).toBeVisible();
  const [o] = await e2eSql("select o.not_before, t.title from outbox o join tasks t on t.id::text = o.options->>'taskId' where o.deal_id = $1 and o.status = 'pending'", [id]);
  expect(o.title).toBe("Remarcar o horário que ela cancelou");
  expect(new Date(o.not_before as string).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
});
