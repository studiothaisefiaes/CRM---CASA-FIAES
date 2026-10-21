import { test, expect, request, type Page } from "@playwright/test";
import { login, simulate, e2eSql, refreshStatsE2E } from "./helpers";

/** Lote 2: a ficha em ordem, a frase de situação, o retorno sugerido, a edição na própria ficha, Lembrar, Agendar, dinheiro só para a gestão. */
const fone = (i: number) => `+557199977${String(i).padStart(4, "0")}`;
const digitado = (i: number) => `71 99977-${String(i).padStart(4, "0")}`;
const contactId = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199977%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

/** Cliente com 4 visitas a cada 50 dias (Avec), a última há 50 dias com observação, e uma Dívida lançada. */
async function clienteDoAvec(page: Page, i: number) {
  await simulate(page, { phone: digitado(i), name: `Rosa${i} Fictícia`, text: "Oi, queria marcar" });
  const id = await contactId(fone(i));
  await e2eSql("insert into professionals (name) select 'MAIARA E2E' where not exists (select 1 from professionals where name = 'MAIARA E2E')");
  const [pro] = await e2eSql("select id from professionals where name = 'MAIARA E2E'");
  for (const [k, n] of [200, 150, 100, 50].entries())
    await e2eSql(`insert into sales_items (contact_id, sold_on, comanda, item, kind, professional_id, professional_name, total_cents, external_key)
      values ($1, ((now() at time zone 'America/Bahia')::date - $2::int), $3, 'Escova', 'servico', $4, 'MAIARA E2E', 15000, $5)
      on conflict do nothing`, [id, n, `e2e-${i}-${k}`, pro.id, `e2e:ficha:${i}:${k}`]);
  await e2eSql(`insert into appointments (contact_id, starts_at, status, service_label, notes, external_key)
    values ($1, now() - interval '50 days', 'compareceu', 'Escova', 'Gosta de água morna', $2) on conflict do nothing`, [id, `e2e:ficha:${i}:ap`]);
  await e2eSql(`insert into sales_payments (contact_id, comanda, paid_on, method, value_cents, external_key)
    values ($1, 'e2e-div', (now() - interval '50 days')::date, 'Dívida', 3000, $2) on conflict do nothing`, [id, `e2e:ficha:${i}:p`]);
  refreshStatsE2E();
  return id;
}

test("ficha em duas colunas: dados à esquerda, abas à direita; frase, hora de voltar, números, visitas com observação, dívida e edição", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page);
  const id = await clienteDoAvec(page, 1);
  await page.goto(`/contatos/${id}`);
  const ordem = await page.locator("[data-bloco]").evaluateAll((els) => els.map((e) => e.getAttribute("data-bloco")));
  expect(ordem).toEqual(["situacao", "proximo", "pacote", "ultima-visita", "retorno", "agora", "numeros", "consultoria", "fidelidade", "consentimento", "proximos", "visitas", "pacotes", "anamnese", "consultoria-visita", "fotos", "financeiro", "conversa", "leads", "anotacoes", "dados"]); // no celular, os dados vêm depois das abas
  // Computador: a coluna da cliente à esquerda e as abas à direita, lado a lado, sem rolagem lateral
  const lado = (await page.getByRole("complementary", { name: "Cliente" }).boundingBox())!;
  const abas = (await page.getByRole("tablist", { name: "Partes da ficha" }).boundingBox())!;
  expect(abas.x).toBeGreaterThanOrEqual(lado.x + lado.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  await expect(page.getByRole("tab")).toHaveText(["Resumo", "Horários", "Pacotes", "Consultoria", "Pagamentos", "Conversas", "Notas"]);
  const visivel = await page.locator("main").innerText(); // só o que está na tela (as outras abas ficam ocultas)
  for (const t of ["FICHA DA CLIENTE", "Dona:", "respondida por", "Retorno sugerido", "Próxima ação", "MAIARA"]) expect(visivel).not.toContain(t);

  await expect(page.getByTestId("frase-situacao")).toContainText("última visita há 50 dias");
  await expect(page.locator('[data-bloco="retorno"]')).toContainText("Hora de voltar");
  await expect(page.locator('[data-bloco="retorno"]')).toContainText("Volta a cada ~50 dias");
  await expect(page.locator('[data-bloco="numeros"]')).toContainText("4");
  // Fidelidade (item 22): cartão pequeno no Resumo (função ligada por padrão) que abre o painel com os programas e o histórico.
  await expect(page.locator('[data-bloco="fidelidade"]')).toContainText("Fiel da Fiaes");
  await page.getByRole("button", { name: "Abrir Fidelidade" }).click();
  await expect(page.getByRole("dialog", { name: "Fidelidade" })).toContainText("Histórico de pontos");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-bloco="ultima-visita"]')).toContainText("Com Maiara E2e");
  await expect(page.locator('[data-bloco="dados"]')).toContainText("100% dos serviços com Maiara E2e");
  await page.getByRole("tab", { name: "Horários" }).click();
  await expect(page).toHaveURL(/aba=horarios/);
  await expect(page.locator('[data-bloco="visitas"]')).toBeVisible();
  await expect(page.locator('[data-bloco="visitas"]')).toContainText("Gosta de água morna");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Dívida lançada no Avec: R$ 30,00");

  // Editar dados fica no "⋯"
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Editar dados/ }).click();
  const dlg = page.getByRole("dialog", { name: "Editar dados" });
  const aniversario = dlg.getByLabel("Aniversário");
  await aniversario.fill("17/10");
  await aniversario.blur();
  await expect(dlg.getByText("salvo").first()).toBeVisible();
  await dlg.getByRole("button", { name: "Pronto" }).click();
  await expect(page.locator('[data-bloco="dados"]')).toContainText("17/10");

  await page.getByRole("tab", { name: "Notas" }).click();
  const avisos = page.getByRole("textbox", { name: "Avisos fixos" }); // a lista do topo também se chama "Avisos fixos"
  await avisos.fill("Alérgica a amônia");
  await avisos.blur();
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Alérgica a amônia"); // salvou (a ficha se atualiza)
  await page.reload();
  await expect(page.getByRole("tab", { name: "Notas" })).toHaveAttribute("aria-selected", "true"); // a aba mora na URL
  await expect(page.locator('[data-bloco="dados"]')).toContainText("17/10");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Alérgica a amônia");

  await page.getByRole("tab", { name: "Resumo" }).click();
  await page.getByRole("button", { name: /^Lembrar/ }).first().click();
  await expect(page.getByText(/Lembrete criado/)).toBeVisible();
  await page.getByRole("button", { name: "Agendar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/atendimento/[0-9a-f-]+\\?agendar=1`));
  await expect(page.getByRole("dialog")).toBeVisible(); // a folha Agendar abriu sozinha
});

test("pacote: selo 'Pacote: 3 de 4' no topo leva à aba Pacotes, com sessões usadas, validade e valor", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 4);
  await e2eSql(`insert into client_packages (contact_id, client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, external_key)
    values ($1, 'Rosa4 Fictícia', 'Pacote 4 Escovas', 'Escova', 4, 3, 48000, ((now() at time zone 'America/Bahia')::date - 160), ((now() at time zone 'America/Bahia')::date + 20), $2)
    on conflict do nothing`, [id, "e2e:ficha:4:pac"]);
  await e2eSql("update sales_items set from_package = true where contact_id = $1", [id]);
  await page.goto(`/contatos/${id}`);
  await page.getByRole("button", { name: "Pacote: 3 de 4. Ver pacotes" }).click();
  await expect(page.getByRole("tab", { name: /Pacotes/ })).toHaveAttribute("aria-selected", "true");
  const pac = page.getByTestId("pacotes");
  await expect(pac).toBeVisible();
  await expect(pac.getByRole("meter", { name: "3 de 4 sessões usadas" })).toBeVisible();
  await expect(pac).toContainText("vence em 20 dias");
  await expect(pac).toContainText("R$ 480,00");
  await expect(pac.getByRole("list", { name: "Sessões usadas de Pacote 4 Escovas" }).getByRole("listitem")).toHaveCount(3);
  await expect(pac).toContainText("Com Maiara E2e");
});

test("pacote do Avec em várias linhas (uma por serviço): um pacote só no selo, na situação e na aba Pacotes; outra compra fica separada", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 6);
  const hoje = "(now() at time zone 'America/Bahia')::date";
  for (const [k, [svc, used]] of ([["Finalização Metodo Fiaes", 1], ["Confeção Metodo Fiaes", 2], ["Meia Aplicação Metodo Fiaes", 3], ["Confecção Cabelo Metodo Fiaes", 1]] as const).entries())
    await e2eSql(`insert into client_packages (contact_id, client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, external_key)
      values ($1, 'Rosa6 Fictícia', 'Combo Manutenção Método Fiaes', $2, 4, $3, 800000, ${hoje} - 60, ${hoje} + 300, $4) on conflict do nothing`, [id, svc, used, `e2e:ficha:6:combo${k}`]);
  // Outra compra (outro dia): continua outro pacote.
  await e2eSql(`insert into client_packages (contact_id, client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, external_key)
    values ($1, 'Rosa6 Fictícia', 'Combo Manutenção Método Fiaes', 'Finalização Metodo Fiaes', 4, 0, 800000, ${hoje} - 5, ${hoje} + 360, $2) on conflict do nothing`, [id, "e2e:ficha:6:combo-novo"]);
  await page.goto(`/contatos/${id}`);
  await expect(page.getByText(/pacote 3\/4/).first()).toBeVisible();
  await page.getByRole("button", { name: "Pacote: 3 de 4. Ver pacotes" }).click();
  await expect(page.getByRole("tab", { name: /Pacotes/ })).toContainText("2");
  const pac = page.getByTestId("pacotes");
  await expect(pac.locator(":scope > li")).toHaveCount(2);
  const svc = pac.getByRole("list", { name: "Serviços do pacote Combo Manutenção Método Fiaes" }).first();
  await expect(svc.getByRole("listitem")).toHaveText(["Confeção Método Fiaes2 de 4", "Confecção Cabelo Método Fiaes1 de 4", "Finalização Método Fiaes1 de 4", "Meia Aplicação Método Fiaes3 de 4"]);
  await expect(pac.getByRole("meter", { name: "3 de 4 sessões usadas" })).toBeVisible();
  await expect(pac.getByText("R$ 8.000,00")).toHaveCount(2); // uma vez por compra
});

test("atendente: vê visitas e faltas, mas nenhum R$ (só 'Tem dívida lançada no Avec')", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 2);
  await login(page, "ana@e2e.local");
  await page.goto(`/contatos/${id}`);
  await expect(page.locator('[data-bloco="numeros"]')).toContainText("Visitas");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Tem dívida lançada no Avec");
  await expect(page.locator("main")).not.toContainText("R$");
  await expect(page.locator('[data-bloco="financeiro"]')).toHaveCount(0);
});

test("Leads: 'Mesclado (mesmo número)' separado de 'Não é cliente'", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await simulate(page, { phone: digitado(3), name: "Lia Fictícia", text: "Oi" });
  const id = await contactId(fone(3));
  // um lead que saiu na junção do número oculto (sem pessoa e sem o evento "arquivado") e um "Não é cliente" (com o evento)
  await e2eSql(`insert into deals (contact_id, stage_id, archived_at, created_at) select $1, s.id, now(), now() - interval '20 days' from stages s where s.key = 'lead'`, [id]);
  const [ign] = await e2eSql(`insert into deals (contact_id, stage_id, archived_at, created_at) select $1, s.id, now(), now() - interval '10 days' from stages s where s.key = 'lead' returning id`, [id]);
  await e2eSql(`insert into deal_events (deal_id, type, payload) values ($1, 'arquivado', '{}')`, [ign.id]);
  await page.goto(`/contatos/${id}`);
  const leads = page.locator('[data-bloco="leads"]');
  await expect(leads).toContainText("Mesclado (mesmo número)");
  await expect(leads).toContainText("Não é cliente");
});

test("Consultoria: anamnese em passos (uma pergunta por tela), consultoria por visita, foto de antes e depois protegida", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 9);
  // O banco do e2e não traz as perguntas da Casa: três da anamnese e uma da consultoria, com id fixo (roda 2 vezes)
  await e2eSql(`insert into form_questions (id, form, position, label, kind, options) values
    (md5('e2e:ficha:a1')::uuid, 'anamnese', 0, 'Como conheceu a Casa Fiaes?', 'opcao', ARRAY['Indicação','Instagram','Evento']),
    (md5('e2e:ficha:a2')::uuid, 'anamnese', 1, 'Como é sua rotina hoje?', 'opcao', ARRAY['Muito corrida','Moderada','Tranquila']),
    (md5('e2e:ficha:a3')::uuid, 'anamnese', 2, 'Você pratica atividade física? Qual?', 'texto', '{}'),
    (md5('e2e:ficha:c1')::uuid, 'consultoria', 0, 'Como é o estilo da cliente?', 'texto', '{}') on conflict do nothing`);
  await e2eSql("delete from client_photos where contact_id = $1", [id]);
  await e2eSql("delete from form_answers where contact_id = $1", [id]);
  await e2eSql("delete from form_answers where visit_id in (select id from visits where contact_id = $1)", [id]); // QA r66 M-5
  await e2eSql("delete from visits where contact_id = $1", [id]);
  await e2eSql("insert into visits (contact_id, day) values ($1, (now() at time zone 'America/Bahia')::date - 3)", [id]);
  await page.goto(`/contatos/${id}`);
  // O cartão pequeno do Resumo abre a aba
  const card = page.locator('[data-bloco="consultoria"]');
  await expect(card).toContainText("Anamnese: 0 de");
  await card.getByRole("button", { name: "Abrir Consultoria" }).click();
  await expect(page.getByRole("tab", { name: "Consultoria" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/aba=consultoria/);

  // Anamnese: uma pergunta por tela, salva ao avançar
  await page.getByRole("button", { name: "Preencher" }).click();
  const dlg = page.getByRole("dialog", { name: "Anamnese" });
  await expect(dlg.getByText(/^Pergunta 1 de \d+$/)).toBeVisible();
  await expect(dlg.getByText("Como conheceu a Casa Fiaes?")).toBeVisible();
  await expect(dlg.getByText("Como é sua rotina hoje?")).toHaveCount(0);
  await dlg.getByRole("radio", { name: "Instagram" }).click();
  await dlg.getByRole("button", { name: "Próxima" }).click();
  await expect(dlg.getByText(/^Pergunta 2 de \d+$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-bloco="anamnese"]')).toContainText(/1 de \d+ respondidas/);

  // Consultoria de imagem: "Nova" usa a visita mais recente
  await page.getByRole("button", { name: "Nova" }).click();
  const con = page.getByRole("dialog", { name: "Consultoria de imagem" });
  await expect(con.getByText(/^Pergunta 1 de \d+$/)).toBeVisible();
  await con.getByRole("textbox").fill("Natural e prático");
  await con.getByRole("button", { name: "Concluir" }).click(); // só uma pergunta de consultoria no banco do e2e
  await expect(page.locator('[data-bloco="consultoria-visita"]')).toContainText("Natural e prático");

  // Foto de antes: bytes mínimos de JPEG (nada gera nem altera imagem), servida só com sessão e sem cache
  await page.getByRole("button", { name: "Adicionar foto" }).click();
  const add = page.getByRole("dialog", { name: "Adicionar foto" });
  await expect(add.getByLabel("Tirar foto")).toHaveAttribute("capture", "environment");
  await expect(add.getByLabel("Escolher arquivo")).not.toHaveAttribute("capture", /.*/); // pode escolher da galeria
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  await add.getByLabel("Escolher arquivo").setInputFiles({ name: "antes.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await add.getByRole("button", { name: "Enviar" }).click();
  const img = page.locator('[data-bloco="fotos"] img').first();
  await expect(img).toHaveAttribute("alt", /^Antes, visita de/);
  const src = (await img.getAttribute("src"))!;
  const r = await page.request.get(src);
  expect(r.status()).toBe(200);
  expect(r.headers()["cache-control"]).toBe("private, no-store");
  const anonima = await request.newContext({ storageState: { cookies: [], origins: [] } });
  const semSessao = await anonima.get(new URL(src, page.url()).toString(), { maxRedirects: 0 }); // sem sessão: 401 da rota ou o redirecionamento para o login
  expect([307, 401]).toContain(semSessao.status());
  expect(semSessao.headers()["content-type"] ?? "").not.toContain("image/");
  await anonima.dispose();
  await page.getByRole("button", { name: /^Apagar foto de antes/ }).click();
  await page.getByRole("dialog", { name: "Apagar esta foto?" }).getByRole("button", { name: "Apagar" }).click();
  await expect(page.locator('[data-bloco="fotos"] img')).toHaveCount(0);
  expect((await page.request.get(src)).status()).toBe(404);
});
