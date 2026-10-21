import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * QA r58 (caixa desligado em produção; estas correções são condição para ligar). Reproduz, pela tela, os três críticos:
 * C-1 (falta no dinheiro com sobra no Pix não pode virar diferença zero), C-2 (o "entrou hoje" do Caixa bate com as Entradas do
 * Financeiro, inclusive o pagamento parcial) e C-3 (cortesia fora do faturamento por profissional, serviço e comissão). E mais:
 * Nova comanda sem comanda vazia (I-8) e os botões de dinheiro com 44 px no celular (I-9). Capturas em CAPTURAS_DIR, quando definido.
 */
const OFFSET_MS = 3 * 3_600_000;
const hoje = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
const id = async (sql: string, p: unknown[] = []) => String((await e2eSql(sql, p))[0].id);
const shot = async (page: Page, name: string) => {
  if (!process.env.CAPTURAS_DIR) return;
  await page.waitForTimeout(500); // só para a captura: a folha termina de entrar
  await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, `qa58-fix-${name}.png`), fullPage: false });
};

/** Comanda aberta hoje com um item. Serviço: horário já Finalizado com a Maiara (vai para A receber); produto: sem horário. */
async function comanda(number: number, cliente: string, item: { kind: "servico" | "produto"; label: string; cents: number }) {
  const ana = await id("select id from users where email = 'ana@e2e.local'");
  const c = await id("insert into comandas (day, number, client_name, opened_by) values ($1, $2, $3, $4) returning id", [hoje(), number, cliente, ana]);
  let appt: string | null = null, pro: string | null = null, svc: string | null = null;
  if (item.kind === "servico") {
    pro = await id("select id from professionals where name = 'Maiara'");
    svc = await id("select id from lists where kind = 'service' and label = $1", [item.label]);
    appt = await id(`insert into appointments (client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, finished_at, origin, external_key)
      values ($1, $2, $3, $4, now() - interval '2 hours', 60, $5, 'compareceu', now() - interval '30 minutes', 'crm', 'e2e:' || gen_random_uuid()) returning id`, [cliente, pro, svc, item.label, item.cents]);
  }
  await e2eSql(`insert into comanda_items (comanda_id, kind, label, service_id, appointment_id, professional_id, qty, unit_cents, original_unit_cents, fiscal_kind, added_by)
    values ($1, $2, $3, $4, $5, $6, 1, $7, $7, $8, $9)`, [c, item.kind, item.label, svc, appt, pro, item.cents, item.kind === "produto" ? "produto" : "servico", ana]);
  return c;
}

async function limpa() {
  for (const t of ["comanda_payments", "comanda_items", "client_credit_entries", "comandas", "cash_movements", "cash_sessions", "payment_method_options"]) await e2eSql(`delete from ${t}`);
  for (const t of ["pro_notifications", "client_notes", "client_links"]) await e2eSql(`delete from ${t}`);
  await e2eSql("delete from appointments where origin = 'crm'");
  await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
  await e2eSql("delete from visits");
  await e2eSql(`insert into settings (key, value) values ('caixa_regras', '{"notaPadrao":"sem_cpf"}') on conflict (key) do update set value = excluded.value`); // o padrão: contagem cega ligada
  await e2eSql("delete from audit_log where action like 'caixa_%' or action in ('cortesia', 'desconto', 'preco_alterado', 'estorno')");
}

/**
 * Recebe uma forma na comanda aberta no painel e espera a comanda recarregar com o pagamento (o valor volta ao restante depois de cada
 * recebimento: preencher antes disso corre contra a recarga).
 */
async function receber(painel: Locator, forma: string, valor: string, o: { bandeira?: string; motivo?: string } = {}) {
  const antes = await painel.getByText(/^Caixa de Ana/).count();
  await painel.getByRole("radio", { name: forma, exact: true }).click();
  if (o.bandeira) await painel.getByRole("radio", { name: o.bandeira }).click();
  if (o.motivo) await painel.getByLabel("Motivo da cortesia").fill(o.motivo);
  await painel.getByLabel("Valor recebido (R$)").fill(valor);
  await painel.getByRole("button", { name: /^Receber/ }).click(); // "Receber e fechar" quando completa o total (psico r68 #4)
  await expect(painel.getByText(/^Caixa de Ana/)).toHaveCount(antes + 1);
}

test.describe("QA r58: caixa", () => {
  test.beforeEach(async () => { await limpa(); });
  test.afterAll(async () => { await limpa(); });

  test("C-1, C-2 e C-3: falta no dinheiro com sobra no Pix pede a gestão; Caixa e Financeiro batem; cortesia fora do faturamento", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop: a fila e a comanda lado a lado");
    await comanda(901, "Silvana Couto", { kind: "produto", label: "Kit Silvana", cents: 15000 });
    await comanda(902, "Fabiana Henriques", { kind: "servico", label: "Corte", cents: 6000 });
    await comanda(903, "Tânia Troco", { kind: "produto", label: "Kit Tânia", cents: 7000 });
    await comanda(904, "Paula Parcial", { kind: "produto", label: "Kit Paula", cents: 9000 });

    // A Recepção (Ana, sem caixa.gerir) abre o caixa com R$ 100 e recebe; a contagem cega nasce ligada.
    await login(page, "ana@e2e.local");
    await page.goto("/caixa");
    await page.getByLabel("Fundo de troco (R$)").fill("100");
    await page.getByRole("button", { name: "Abrir caixa, Ana" }).click();
    await expect(page.getByText(/^Caixa de Ana · aberto/)).toBeVisible();
    await expect(page.getByText(/entrou hoje/)).toHaveCount(0); // contagem cega: sem o total do dia

    const abrir = async (n: number, nome: string) => {
      await page.getByRole("region", { name: "A receber" }).getByRole("button", { name: `Comanda ${n} · ${nome}` }).click();
      return page.getByRole("region", { name: `Comanda ${n} · ${nome}` });
    };
    let p = await abrir(901, "Silvana Couto");
    await receber(p, "Pix", "50");
    await expect(p.getByText(/^Restante a pagar$/)).toBeVisible();
    await receber(p, "Dinheiro", "70");
    await receber(p, "Débito", "30", { bandeira: "Visa" });
    await expect(page.getByText(/comanda 901 fechada$/)).toBeVisible();

    p = await abrir(902, "Fabiana Henriques");
    await receber(p, "Cortesia", "60", { motivo: "aniversário da cliente" });
    await expect(page.getByText(/comanda 902 fechada$/)).toBeVisible();

    p = await abrir(903, "Tânia Troco");
    await receber(p, "Dinheiro", "100");
    await expect(page.getByText(/comanda 903 fechada$/)).toBeVisible();

    p = await abrir(904, "Paula Parcial");
    await receber(p, "Pix", "40"); // parcial: R$ 40 já na gaveta, comanda aberta
    await expect(page.getByRole("region", { name: "A receber" }).getByText(/^falta R\$\s50$/)).toBeVisible();
    // Contagem cega: "Pagas hoje" sem o valor de cada comanda.
    await expect(page.getByRole("region", { name: "Pagas hoje" }).getByRole("button", { name: "Comanda 901 · Silvana Couto" })).not.toContainText("R$");

    // C-1: esperado dinheiro 240 (100 + 70 + 100 − 30), Pix 90, débito 30. Conta 140 no dinheiro e 190 no Pix: duas diferenças.
    // O fechamento mora em Caixa › Fechar caixa / dia (3 passos): o passo 3 abre o mesmo diálogo de contagem.
    await page.getByRole("link", { name: "Fechar caixa / dia" }).click();
    await page.goto("/caixa/fechar-dia?passo=3");
    await page.getByRole("button", { name: "Fechar meu caixa" }).click();
    const fechar = page.getByRole("dialog", { name: "Fechar caixa" });
    await expect(fechar.getByText("Sistema", { exact: true })).toHaveCount(0); // contagem cega: sem a coluna do esperado
    await fechar.getByLabel("Quantidade de R$ 100", { exact: true }).fill("1");
    await fechar.getByLabel("Quantidade de R$ 20", { exact: true }).fill("2");
    await fechar.getByLabel("Pix contado (R$)").fill("190");
    await fechar.getByLabel("Débito contado (R$)").fill("30");
    await fechar.getByRole("button", { name: "Fechar caixa" }).click();
    await expect(fechar.getByText(/acima da tolerância/)).toBeVisible(); // antes: "Caixa fechado. Diferença: R$ 0"
    await fechar.getByLabel("E-mail da gestão").fill("gestao@e2e.local");
    await fechar.getByLabel("Senha da gestão").fill("senha-e2e-123");
    await fechar.getByRole("button", { name: "Aprovar e fechar" }).click();
    await expect(page.getByText(/^Caixa fechado\. Diferenças: Dinheiro -R\$\s100 · Pix R\$\s100$/)).toBeVisible();
    await expect(fechar.getByText(/^Dinheiro: esperado R\$\s240, contado R\$\s140, diferença -R\$\s100$/)).toBeVisible();
    await shot(page, "fechamento-por-forma");
    const [cx] = await e2eSql("select counted->>'dinheiro' as dinheiro, counted->>'pix' as pix, approved_by = (select id from users where email = 'gestao@e2e.local') as aprovado from cash_sessions");
    expect(cx).toEqual({ dinheiro: "14000", pix: "19000", aprovado: true });
    // C-3: a cortesia não comissiona.
    expect((await e2eSql("select commission_base_cents as base from comanda_items where label = 'Corte'"))[0]).toEqual({ base: 0 });

    // C-2: o Caixa (gestão) e o Financeiro dizem o mesmo "entrou hoje": 150 + 70 + 40 = 260, Pix 90.
    await login(page);
    await page.goto("/caixa");
    await page.getByRole("button", { name: "Ver as comandas sem abrir o caixa" }).click(); // o caixa da gestão está fechado: só o convite (r68 #5)
    await expect(page.getByText(/R\$\s260\s*entrou hoje/)).toBeVisible();
    await expect(page.getByText(/Pix R\$\s90/)).toBeVisible();
    await page.goto(`/relatorios?aba=financeiro&de=${hoje()}&ate=${hoje()}`);
    const entradas = page.locator("section", { has: page.getByRole("heading", { name: "Entradas", exact: true }) });
    await expect(entradas).toContainText(/Entradas no CRM\s*R\$\s260/);
    const formas = page.getByRole("table", { name: "Formas de pagamento" });
    await expect(formas.getByRole("row").filter({ has: page.getByRole("cell", { name: "Pix", exact: true }) })).toContainText(/R\$\s90/);
    const caixas = page.getByRole("table", { name: "Por caixa" });
    await expect(caixas.getByRole("row").filter({ hasText: "Ana" })).toContainText(/R\$\s260/);
    await expect(caixas.getByRole("row").filter({ hasText: "Ana" })).toContainText(/Dinheiro -R\$\s100\s*Pix R\$\s100/);
    // C-3: a Maiara só fez a cortesia: fora de Por profissional e de Por serviço; a cortesia fica em Formas e Exceções.
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Por profissional" }) })).toContainText(/Maiara\s*R\$\s?0\s*0\s*R\$\s?0/); // só CRM no período: CRM, Itens e Comissão CRM (as colunas do Avec saem, r68 #20) // só a linha zerada (a Fase A lista a profissional sem venda)
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Por serviço e categoria" }) })).not.toContainText("Corte");
    await expect(formas.getByRole("row").filter({ hasText: "Cortesia" })).toContainText(/R\$\s60/);
    // I-4: um fechamento, uma linha por forma com diferença; nenhuma "acima da tolerância" repetida.
    const excecoes = page.getByRole("table", { name: "Exceções" });
    await expect(excecoes.getByRole("row").filter({ hasText: "Diferença no fechamento" })).toHaveCount(2);
    await expect(excecoes.getByRole("row").filter({ hasText: "Fechamento acima da tolerância" })).toHaveCount(0);
    await expect(excecoes.getByRole("row").filter({ hasText: "Cortesia" })).toContainText("aniversário da cliente");
    await shot(page, "financeiro");
  });

  test("Nova comanda (I-8): não cria nada no clique; nasce com o primeiro item", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    // Produto em texto livre só com Produtos e estoque desligado (ligado, vira escolha do catálogo).
    await e2eSql(`insert into settings (key, value) values ('estoque_config', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" })]);
    await login(page);
    await page.goto("/caixa");
    await page.getByRole("button", { name: "Ver as comandas sem abrir o caixa" }).click(); // dsgfix r68 #5: fechado, o Caixa mostra só o convite
    await page.getByRole("button", { name: "Nova comanda" }).click();
    const nova = page.getByRole("region", { name: "Nova comanda" });
    await expect(nova.getByText("A comanda só passa a existir quando o primeiro item for somado.")).toBeVisible();
    expect(await e2eSql("select count(*)::int as n from comandas")).toEqual([{ n: 0 }]);
    await nova.getByRole("radio", { name: "Produto" }).click();
    await nova.getByLabel("Produto").fill("Shampoo");
    await nova.getByLabel("Preço (R$)").fill("40");
    await nova.getByRole("button", { name: "Somar à comanda" }).click();
    await expect(page.getByRole("region", { name: /^Comanda \d+ · Cliente de balcão$/ }).getByText("Shampoo")).toBeVisible();
    expect(await e2eSql("select count(*)::int as n from comandas")).toEqual([{ n: 1 }]);
  });

  test("celular (I-9): Tirar e Estornar com pelo menos 44 px no toque", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const c = await comanda(905, "Rosa Alvo", { kind: "produto", label: "Kit Rosa", cents: 9000 });
    const gestao = await id("select id from users where email = 'gestao@e2e.local'");
    await e2eSql("insert into comanda_payments (comanda_id, method, value_cents, created_by) values ($1, 'pix', 4000, $2)", [c, gestao]);
    await login(page);
    await page.goto("/caixa");
    await page.getByRole("button", { name: "Ver as comandas sem abrir o caixa" }).click(); // dsgfix r68 #5: fechado, o Caixa mostra só o convite
    await page.getByRole("region", { name: "A receber" }).getByRole("button", { name: "Comanda 905 · Rosa Alvo" }).click();
    const folha = page.getByRole("dialog", { name: "Comanda 905 · Rosa Alvo" });
    for (const alvo of [folha.getByRole("button", { name: "Tirar Kit Rosa" }), folha.getByRole("button", { name: "Estornar" }), folha.getByRole("button", { name: "Ajustar Kit Rosa" })]) {
      await expect(alvo).toBeVisible();
      const box = (await alvo.boundingBox())!;
      expect([Math.round(box.width) >= 44, Math.round(box.height) >= 44]).toEqual([true, true]);
    }
    await shot(page, "comanda-celular");
  });
});
