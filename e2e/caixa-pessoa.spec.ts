import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Plano 3 (17/10): caixa POR PESSOA e o pagamento novo (Norte Vendas, sem taxa de 10%). Desktop: a fila A receber à esquerda e a comanda à
 * direita; preço com motivo; crédito com bandeira e parcelas; pagamento parcial; diferença acima da tolerância aprovada pela gestão;
 * Caixas da equipe; Formas de pagamento. Capturas em CAPTURAS_DIR, quando definido (headless, sem janela).
 */
const OFFSET_MS = 3 * 3_600_000;
const hoje = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
const id = async (sql: string, p: unknown[] = []) => String((await e2eSql(sql, p))[0].id);
const shot = async (page: Page, name: string) => {
  if (!process.env.CAPTURAS_DIR) return;
  await page.waitForTimeout(500); // só para a captura: a folha termina de entrar
  await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, `caixa-${name}.png`), fullPage: false });
};

/** Comanda aberta hoje, com um item. Serviço: horário já Finalizado (vai para A receber); produto: sem horário. */
async function comanda(number: number, cliente: string, item: { kind: "servico" | "produto"; label: string; cents: number }) {
  const gestao = await id("select id from users where email = 'gestao@e2e.local'");
  const c = await id("insert into comandas (day, number, client_name, opened_by) values ($1, $2, $3, $4) returning id", [hoje(), number, cliente, gestao]);
  let appt: string | null = null, pro: string | null = null, svc: string | null = null;
  if (item.kind === "servico") {
    pro = await id("select id from professionals where name = 'Maiara'");
    svc = await id("select id from lists where kind = 'service' and label = $1", [item.label]);
    appt = await id(`insert into appointments (client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, finished_at, origin, external_key)
      values ($1, $2, $3, $4, now() - interval '2 hours', 60, $5, 'compareceu', now() - interval '30 minutes', 'crm', 'e2e:' || gen_random_uuid()) returning id`, [cliente, pro, svc, item.label, item.cents]);
  }
  await e2eSql(`insert into comanda_items (comanda_id, kind, label, service_id, appointment_id, professional_id, qty, unit_cents, original_unit_cents, fiscal_kind, added_by)
    values ($1, $2, $3, $4, $5, $6, 1, $7, $7, $8, $9)`, [c, item.kind, item.label, svc, appt, pro, item.cents, item.kind === "produto" ? "produto" : "servico", gestao]);
  return c;
}

test.describe("Plano 3: caixa por pessoa", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop: a fila e a comanda lado a lado");
    for (const t of ["comanda_payments", "comanda_items", "client_credit_entries", "comandas", "cash_movements", "cash_sessions", "payment_method_options"]) await e2eSql(`delete from ${t}`);
    for (const t of ["pro_notifications", "client_notes", "client_links"]) await e2eSql(`delete from ${t}`);
    await e2eSql("delete from appointments where origin = 'crm'");
    await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
    await e2eSql("delete from visits");
    await e2eSql(`insert into settings (key, value) values ('caixa_regras', '{"notaPadrao":"sem_cpf"}') on conflict (key) do update set value = excluded.value`);
    await login(page);
  });

  test("A receber à esquerda, comanda à direita: preço com motivo, crédito com bandeira e parcelas, parcial e Pagas hoje", async ({ page }) => {
    await comanda(901, "Fila Pronta", { kind: "servico", label: "Corte", cents: 12000 });
    await comanda(902, "Parcial Paula", { kind: "produto", label: "Kit", cents: 8000 });
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("100");
    await page.getByRole("button", { name: "Abrir caixa, Thaíse" }).click();
    await expect(page.getByText(/^Caixa de Thaíse · aberto \d\d:\d\d$/)).toBeVisible();

    const receber = page.getByRole("region", { name: "A receber" });
    await expect(receber.getByRole("button", { name: "Comanda 901 · Fila Pronta" })).toBeVisible();
    await expect(receber.getByRole("button", { name: "Comanda 902 · Parcial Paula" })).toBeVisible();
    await receber.getByRole("button", { name: "Comanda 901 · Fila Pronta" }).click();
    const painel = page.getByRole("region", { name: "Comanda 901 · Fila Pronta" });
    await expect(painel.getByRole("region", { name: "Itens" }).getByText("Corte", { exact: true })).toBeVisible();
    await shot(page, "a-receber");

    await painel.getByRole("button", { name: "Ajustar Corte" }).click();
    await painel.getByLabel("Preço de Corte (R$)").fill("100");
    await painel.getByLabel("Motivo", { exact: true }).fill("cliente antiga");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel.getByText("(cliente antiga)")).toBeVisible();

    await painel.getByRole("radio", { name: "Crédito" }).click();
    await painel.getByRole("radio", { name: "Visa" }).click();
    await painel.getByLabel("Parcelas").selectOption("3");
    await expect(painel.getByLabel("Valor recebido (R$)")).toHaveValue("100,00");
    await shot(page, "pagamento");
    await painel.getByRole("button", { name: "Receber e fechar" }).click(); // psico r68 #4: completa o total e fecha junto
    await expect(page.getByText(/comanda 901 fechada$/)).toBeVisible();
    await expect(painel.getByText("Crédito · Visa · 3x")).toBeVisible();
    await expect(page.getByRole("region", { name: "Pagas hoje" }).getByRole("button", { name: "Comanda 901 · Fila Pronta" })).toBeVisible();
    const [pg] = await e2eSql("select brand, installments, cash_session_id is not null as no_caixa from comanda_payments");
    expect(pg).toEqual({ brand: "visa", installments: 3, no_caixa: true });
    expect((await e2eSql("select data from audit_log where action = 'preco_alterado'"))[0].data).toMatchObject({ de: 12000, para: 10000, motivo: "cliente antiga" });

    // Pagamento parcial: a comanda continua em A receber, com saldo.
    await page.getByRole("region", { name: "A receber" }).getByRole("button", { name: "Comanda 902 · Parcial Paula" }).click();
    const parcial = page.getByRole("region", { name: "Comanda 902 · Parcial Paula" });
    await parcial.getByRole("radio", { name: "Pix" }).click();
    await parcial.getByLabel("Valor recebido (R$)").fill("30");
    await parcial.getByRole("button", { name: "Receber" }).click();
    await expect(page.getByRole("region", { name: "A receber" }).getByText(/^falta R\$\s50$/)).toBeVisible();
  });

  test("diferença acima da tolerância: a atendente fecha com a aprovação da gestão; Caixas da equipe mostra os dois caixas", async ({ page }) => {
    await login(page, "ana@e2e.local");
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("0");
    await page.getByRole("button", { name: "Abrir caixa, Ana" }).click();
    await expect(page.getByText(/^Caixa de Ana · aberto/)).toBeVisible();
    await page.getByRole("link", { name: "Fechar caixa / dia" }).click();
    await page.getByRole("link", { name: /3\s*Fechar o caixa/ }).click();
    await page.getByRole("button", { name: "Fechar meu caixa" }).click();
    const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
    await expect(fechar.getByLabel("Quantidade de R$ 200", { exact: true })).toBeFocused(); // a folha foca o primeiro campo ao abrir
    await fechar.getByLabel("Quantidade de R$ 50", { exact: true }).fill("1"); // 50 a mais que o esperado (0)
    await fechar.getByRole("button", { name: "Fechar caixa" }).click();
    await expect(fechar.getByText(/acima da tolerância/)).toBeVisible();
    await fechar.getByLabel("E-mail da gestão").fill("gestao@e2e.local");
    await fechar.getByLabel("Senha da gestão").fill("senha-e2e-123");
    await shot(page, "aprovacao");
    await fechar.getByRole("button", { name: "Aprovar e fechar" }).click();
    await expect(page.getByText(/^Caixa fechado\. Diferença: /)).toBeVisible();
    const [s] = await e2eSql("select difference_cents, approved_by = (select id from users where email = 'gestao@e2e.local') as aprovado from cash_sessions");
    expect(s).toEqual({ difference_cents: 5000, aprovado: true });

    await login(page);
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("150");
    await page.getByRole("button", { name: "Abrir caixa, Thaíse" }).click();
    await expect(page.getByText(/^Caixa de Thaíse · aberto/)).toBeVisible();
    await page.getByRole("link", { name: "Fechar caixa / dia" }).click();
    await page.getByRole("link", { name: /3\s*Fechar o caixa/ }).click();
    await page.getByRole("button", { name: "Fechar meu caixa" }).click();
    await expect(page.getByRole("dialog", { name: "Fechar caixa" }).getByText("Sistema")).toBeVisible();
    await shot(page, "fechamento");
    await page.keyboard.press("Escape");

    await page.goto("/caixa/equipe");
    const tabela = page.getByRole("region", { name: "Caixas" });
    const linha = (nome: string) => tabela.getByRole("row").filter({ has: page.getByRole("cell", { name: nome, exact: true }) });
    await expect(linha("Ana Souza")).toContainText("Diferença aprovada por Thaíse Fiaes");
    await expect(linha("Thaíse Fiaes")).toContainText("Aberto");
    // dsgfix r68 #4: as regras saíram da operação; Caixas da equipe leva a Configurações › Caixa
    await expect(page.getByRole("region", { name: "Regras do fechamento" })).toHaveCount(0);
    await shot(page, "equipe");
    await page.getByRole("link", { name: "Regras do fechamento ›" }).click();
    await expect(page.getByRole("region", { name: "Regras do fechamento" })).toBeVisible();
  });

  test("Serviços e pacotes › Formas de pagamento: a gestão cadastra a outra forma e ela aparece no caixa", async ({ page }) => {
    await comanda(903, "Outra Forma", { kind: "produto", label: "Kit", cents: 5000 });
    await page.goto("/servicos?aba=formas");
    await page.getByLabel("Nova forma").fill("Transferência");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByLabel("Nome de Transferência")).toBeVisible();
    await shot(page, "formas");
    await page.goto("/caixa");
    await page.getByRole("button", { name: "Ver as comandas sem abrir o caixa" }).click(); // dsgfix r68 #5: fechado, o Caixa mostra só o convite
    await page.getByRole("region", { name: "A receber" }).getByRole("button", { name: "Comanda 903 · Outra Forma" }).click();
    const painel = page.getByRole("region", { name: "Comanda 903 · Outra Forma" });
    await painel.getByRole("radio", { name: "Outra forma" }).click();
    await painel.getByLabel("Qual forma").selectOption({ label: "Transferência" });
    await painel.getByRole("button", { name: /^Receber/ }).click();
    await expect(painel.getByText("Outra forma · Transferência")).toBeVisible();
  });
});
