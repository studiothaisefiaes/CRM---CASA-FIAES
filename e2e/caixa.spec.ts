import { expect, test } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Lote 6C + Plano 3 (caixa por pessoa): abrir o próprio caixa → comanda pelo card → pagamento dividido → Finalizar → selo R$ → fechar
 * caixa contando por cédula, com diferença dentro da tolerância → relatório de comissão (desktop); e a aba "Já pagaram" no desktop e no celular.
 */
const OFFSET_MS = 3 * 3_600_000;
const hoje = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
const agoraHM = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(11, 16);
const em = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).toISOString();
const id = async (sql: string, p: unknown[] = []) => String((await e2eSql(sql, p))[0].id);

test.describe("Lote 6C: caixa", () => {
  test.beforeEach(async ({ page }) => {
    for (const t of ["loyalty_entries", "comanda_payments", "comanda_items", "client_credit_entries", "comandas", "cash_movements", "cash_sessions", "payment_method_options"]) await e2eSql(`delete from ${t}`);
    // 7A/7B: avisos da profissional, ficha técnica e links da cliente apontam para horários e visitas.
    for (const t of ["pro_notifications", "client_notes", "client_links"]) await e2eSql(`delete from ${t}`);
    await e2eSql("delete from appointments where origin = 'crm'");
    await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
    await e2eSql("delete from visits");
    await e2eSql(`insert into settings (key, value) values ('caixa_regras', '{"notaPadrao":"sem_cpf"}') on conflict (key) do update set value = excluded.value`); // o teste do Perguntar troca; os outros seguem com Emitir sem CPF
    await e2eSql("delete from client_packages where origin = 'crm' or external_key like 'e2e:%'");
    await login(page);
  });

  test("r66: com o padrão 'Perguntar' a nota nasce sem marcação e trava o Receber e o Fechar comanda até a escolha", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    await e2eSql(`insert into settings (key, value) values ('caixa_regras', '{"notaPadrao":"perguntar"}') on conflict (key) do update set value = excluded.value`);
    const maiara = await id("select id from professionals where name = 'Maiara'");
    const corte = await id("select id from lists where kind = 'service' and label = 'Corte'");
    const cliente = await id("insert into contacts (name, phone_e164) values ('Nina Pergunta', '+5571988773099') on conflict (phone_e164) do update set name = excluded.name returning id");
    await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, origin, external_key)
      values ($1, 'Nina Pergunta', $2, $3, 'Corte', $4, 60, 12000, 'agendado', 'crm', 'e2e:' || gen_random_uuid())`, [cliente, maiara, corte, em(hoje(), agoraHM())]);
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("0");
    await page.getByRole("button", { name: "Abrir caixa, Thaíse" }).click();
    await expect(page.getByText(/^Caixa de Thaíse · aberto/)).toBeVisible();
    await page.getByRole("region", { name: "Agendadas de hoje" }).getByRole("button", { name: "Abrir comanda de Nina Pergunta" }).click();
    const painel = page.getByRole("region", { name: /^Comanda \d+ · Nina Pergunta$/ });
    await expect(painel.getByRole("radio", { name: "Não emitir" })).not.toBeChecked();
    await expect(painel.getByRole("radio", { name: "Emitir sem CPF" })).not.toBeChecked();
    await expect(painel.getByRole("button", { name: "Receber" })).toBeDisabled();
    await expect(painel.getByRole("button", { name: "Fechar comanda" })).toBeDisabled();
    await painel.getByRole("radio", { name: "Emitir sem CPF" }).check();
    await expect(painel.getByRole("button", { name: "Receber" })).toBeEnabled();
  });

  test("desktop: Agendadas de hoje → abrir a comanda com um clique, escolher a nota, receber e ver em Pagas hoje", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const maiara = await id("select id from professionals where name = 'Maiara'");
    const corte = await id("select id from lists where kind = 'service' and label = 'Corte'");
    const cliente = await id("insert into contacts (name, phone_e164) values ('Dani Agenda', '+5571988773002') on conflict (phone_e164) do update set name = excluded.name returning id");
    await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, origin, external_key)
      values ($1, 'Dani Agenda', $2, $3, 'Corte', $4, 60, 12000, 'agendado', 'crm', 'e2e:' || gen_random_uuid())`, [cliente, maiara, corte, em(hoje(), agoraHM())]);
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("0");
    await page.getByRole("button", { name: "Abrir caixa, Thaíse" }).click();
    await expect(page.getByText(/^Caixa de Thaíse · aberto/)).toBeVisible();
    const agendadas = page.getByRole("region", { name: "Agendadas de hoje" });
    await agendadas.getByRole("button", { name: "Abrir comanda de Dani Agenda" }).click();
    const painel = page.getByRole("region", { name: /^Comanda \d+ · Dani Agenda$/ });
    await expect(painel.getByRole("region", { name: "Itens" }).getByText("Corte", { exact: true })).toBeVisible();
    await expect(agendadas.getByRole("button", { name: "Abrir comanda de Dani Agenda" })).toHaveCount(0);
    await painel.getByRole("radio", { name: "Pix" }).click();
    await painel.getByRole("radio", { name: "Não emitir" }).check(); // a escolha da nota fica gravada na comanda (o padrão da Casa é Emitir sem CPF)
    await expect.poll(async () => (await e2eSql("select nota_escolha from comandas"))[0].nota_escolha).toBe("nao");
    await painel.getByLabel("Valor recebido (R$)").fill("120");
    // psico r68 #4: o pagamento que completa o total fecha a comanda junto
    await painel.getByRole("button", { name: "Receber e fechar" }).click();
    await expect(page.getByText(/no Pix · comanda \d+ fechada$/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Pagas hoje" }).getByRole("button", { name: /Dani Agenda/ })).toBeVisible();
  });

  test("desktop: abrir caixa, comanda pelo horário, pagamento dividido, Finalizar, selo R$, fechar com diferença e comissão", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const maiara = await id("select id from professionals where name = 'Maiara'");
    const corte = await id("select id from lists where kind = 'service' and label = 'Corte'");
    await e2eSql("update professional_services set commission_bp = 4000 where professional_id = $1 and service_id = $2", [maiara, corte]);
    const cliente = await id("insert into contacts (name, phone_e164) values ('Cris Caixa', '+5571988773001') on conflict (phone_e164) do update set name = excluded.name returning id");
    await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, origin, external_key)
      values ($1, 'Cris Caixa', $2, $3, 'Corte', $4, 60, 12000, 'agendado', 'crm', 'e2e:' || gen_random_uuid())`, [cliente, maiara, corte, em(hoje(), agoraHM())]);

    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("100");
    await page.getByRole("button", { name: "Abrir caixa, Thaíse" }).click();
    await expect(page.getByText("Caixa aberto")).toBeVisible();
    await expect(page.getByText(/^Caixa de Thaíse · aberto \d\d:\d\d$/)).toBeVisible();

    await page.goto("/agenda?v=lista");
    await page.getByTestId("agenda-item").filter({ hasText: "Cris Caixa" }).locator('button[aria-haspopup="dialog"]').click();
    await page.getByRole("dialog", { name: "Cris Caixa" }).getByRole("button", { name: "Abrir comanda" }).click();
    const comanda = page.getByRole("dialog", { name: /^Comanda \d+ · Cris Caixa$/ });
    await expect(comanda.getByRole("region", { name: "Itens" }).getByText("Corte", { exact: true })).toBeVisible();
    await comanda.getByRole("radio", { name: "Pix" }).click();
    await comanda.getByLabel("Valor recebido (R$)").fill("50");
    await comanda.getByRole("button", { name: "Receber" }).click();
    await expect(comanda.getByText("Caixa de Thaíse")).toBeVisible();
    await comanda.getByRole("radio", { name: "Dinheiro" }).click();
    await comanda.getByLabel("Valor recebido (R$)").fill("100");
    await expect(comanda.getByText(/^Troco: R\$\s30$/)).toBeVisible(); // o troco aparece antes de receber
    await comanda.getByRole("button", { name: "Receber e fechar" }).click();
    await expect(page.getByText(/em Dinheiro · comanda \d+ fechada$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("agenda-item").filter({ hasText: "Cris Caixa" }).getByTitle("Comanda fechada")).toBeVisible();
    expect((await e2eSql("select status from appointments where contact_id = $1", [cliente]))[0].status).toBe("compareceu");

    await page.goto("/caixa");
    await page.getByRole("link", { name: "Fechar caixa / dia" }).click();
    await page.getByRole("link", { name: /3\s*Fechar o caixa/ }).click();
    await page.getByRole("button", { name: "Fechar meu caixa" }).click();
    const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
    await expect(fechar.getByLabel("Quantidade de R$ 200", { exact: true })).toBeFocused(); // a folha foca o primeiro campo ao abrir
    // Esperado em dinheiro: 100 + 100 − 30 = 170. Contado por cédula: 100 + 50 + 10 + 5 = 165 (−5, dentro da tolerância de R$ 5).
    for (const [nota, n] of [["R$ 100", "1"], ["R$ 50", "1"], ["R$ 10", "1"], ["R$ 5", "1"]]) await fechar.getByLabel(`Quantidade de ${nota}`, { exact: true }).fill(n);
    await fechar.getByLabel("Pix contado (R$)").fill("50");
    await expect(fechar.getByText(/^Diferença: -R\$\s5$/)).toBeVisible();
    await fechar.getByRole("button", { name: "Fechar caixa" }).click();
    await expect(page.getByText(/^Caixa fechado\. Diferença: /)).toBeVisible();
    expect((await e2eSql("select difference_cents, counted_breakdown from cash_sessions"))[0]).toEqual({ difference_cents: -500, counted_breakdown: { "10000": 1, "5000": 1, "1000": 1, "500": 1 } });

    await page.goto("/caixa/comissao");
    const maiaraSec = page.getByRole("region", { name: "Comissão de Maiara" });
    await expect(maiaraSec.getByRole("row").filter({ hasText: "Corte" })).toContainText("40%");
    await expect(maiaraSec).toContainText(/Comissão R\$\s48/);
  });

  test("Já pagaram: quem pagou e não voltou aparece com 'Sem horário marcado' e Agendar abre o Marcar com a cliente", async ({ page }) => {
    const nina = await id("insert into contacts (name, phone_e164) values ('Nina Pagou', '+5571988773002') on conflict (phone_e164) do update set name = excluded.name returning id");
    await e2eSql(`insert into client_packages (contact_id, client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, origin, external_key)
      values ($1, 'Nina Pagou', 'Combo Método Fiaes', 'Corte', 4, 1, 40000, current_date - 30, current_date + 200, 'avec', 'e2e:' || gen_random_uuid())`, [nina]);
    await page.goto("/agenda?aba=pacotes"); // apelido antigo
    await expect(page).toHaveURL(/aba=pacotes/);
    // Nova Agenda (16/10): Já pagaram é uma aba do painel das pendências, aberto pelo link antigo.
    await expect(page.getByRole("dialog", { name: "Pendências da agenda" }).getByRole("button", { name: /Já pagaram/ })).toHaveAttribute("aria-pressed", "true");
    const linha = page.getByRole("listitem", { name: "Nina Pagou" });
    await expect(linha.getByText(/Combo Método Fiaes · faltam 3 de 4 · vence/)).toBeVisible();
    await page.getByRole("navigation", { name: "Filtrar quem já pagou" }).getByRole("link", { name: "Sem horário marcado" }).click();
    await expect(page.getByRole("listitem", { name: "Nina Pagou" }).getByText("Sem horário marcado")).toBeVisible();
    await page.getByRole("listitem", { name: "Nina Pagou" }).getByRole("button", { name: "Agendar" }).click();
    const dlg = page.getByRole("dialog", { name: "Marcar horário" });
    await expect(dlg.getByRole("region", { name: "Cliente" })).toContainText("Nina Pagou");
  });
});
