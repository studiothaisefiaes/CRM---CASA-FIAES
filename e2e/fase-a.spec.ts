import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eSql, login, shot } from "./helpers";

/**
 * Fase A "Dinheiro certo" de ponta a ponta (desktop e celular): a gestão cadastra a taxa Visa 2,43% em Serviços e pacotes › Formas de
 * pagamento; a recepção abre pela Agenda a comanda do Corte da Maiara (a profissional com app no e2e), vê a Sidney já como assistente,
 * recebe R$ 120 no crédito Visa e vê "Taxas do cartão R$ 2,92" e "Líquido"; outra comanda fica com "Deixar R$ 40 como dívida"; a gestão
 * lança um vale de R$ 50 em Comissão › Lançamentos, abre "A pagar", paga e abre o recibo; a Maiara vê o recibo no /pro/ganhos; o
 * Financeiro mostra "Líquido no CRM" e "Ver todas" abre as Exceções. E o liga/desliga: "Taxa do cartão" desligada em Configurações › Caixa,
 * o crédito novo entra sem taxa. Capturas em CF_SHOTS_DIR (headless).
 */
test.describe.configure({ mode: "serial" });

const OFFSET_MS = 3 * 3_600_000;
const hoje = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
const agoraHM = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(11, 16);
const em = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).toISOString();
/** Primeiro dia do mês anterior e o último (o fim do último período mensal fechado: o "A pagar" lista até ele). */
const mesPassado = () => {
  const [y, m] = hoje().split("-").map(Number);
  const fim = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { inicio: `${fim.slice(0, 8)}01`, fim };
};
const id = async (q: string, p: unknown[] = []) => String((await e2eSql(q, p))[0].id);
const REGRAS_DA_CASA = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" };

async function limpa() {
  for (const t of ["comanda_item_assistants", "comanda_payments", "client_debt_entries", "client_credit_entries", "loyalty_entries", "comanda_items", "comandas",
    "professional_adjustments", "professional_adjustment_rules", "commission_payouts", "cash_movements", "cash_sessions", "payment_fees", "payment_method_options"]) await e2eSql(`delete from ${t}`);
  for (const t of ["pro_notifications", "client_notes", "client_links"]) await e2eSql(`delete from ${t}`);
  await e2eSql("delete from appointments where origin = 'crm'");
  await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
  await e2eSql("delete from visits");
  await e2eSql("delete from settings where key in ('caixa_recursos', 'comissao_regras')");
  await e2eSql(`insert into settings (key, value) values ('caixa_regras', '{"notaPadrao":"sem_cpf"}') on conflict (key) do update set value = excluded.value`);
  await e2eSql("insert into settings (key, value) values ('caixa_modo', to_jsonb('crm'::text)) on conflict (key) do update set value = excluded.value");
  await e2eSql("update professional_services set commission_bp = null, assistant_bp = null");
  await e2eSql("delete from professionals where name = 'Sidney'");
}

/** Sidney é a assistente da Maiara; Corte da Maiara com 60% e 10% da assistente; as regras da Casa (as da migration 0063). */
async function prepara() {
  await limpa();
  const maiara = await id("select id from professionals where name = 'Maiara'");
  const corte = await id("select id from lists where kind = 'service' and label = 'Corte'");
  await e2eSql("insert into professionals (name, assistant_of) values ('Sidney', $1)", [maiara]);
  await e2eSql("update professional_services set commission_bp = 6000, assistant_bp = 1000 where professional_id = $1 and service_id = $2", [maiara, corte]);
  await e2eSql("insert into settings (key, value) values ('comissao_regras', $1::jsonb)", [JSON.stringify(REGRAS_DA_CASA)]);
}

/** Horário de hoje (Chegou) para a cliente com a profissional e o serviço. */
async function horario(cliente: string, fone: string, profissional: string, servico: string, cents: number, hm: string) {
  const contato = await id("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [cliente, fone]);
  const pro = await id("select id from professionals where name = $1", [profissional]);
  const svc = await id("select id from lists where kind = 'service' and label = $1", [servico]);
  await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, price_cents, status, origin, external_key)
    values ($1, $2, $3, $4, $5, $6, 60, $7, 'chegou', 'crm', 'e2e:' || gen_random_uuid())`, [contato, cliente, pro, svc, servico, em(hoje(), hm), cents]);
}

/** Configurações › Caixa › "O que o caixa usa". */
const recursos = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "O que o caixa usa" }) });

async function abreCaixaDaAna(page: Page) {
  await login(page, "ana@e2e.local");
  await page.goto("/caixa");
  await page.getByLabel("Fundo de troco (R$)").fill("0");
  await page.getByRole("button", { name: "Abrir caixa, Ana" }).click();
  await expect(page.getByText(/^Caixa de Ana · aberto/)).toBeVisible();
}

/** Abre a comanda do horário pela Agenda (lista): a folha "Comanda N · cliente". */
async function comandaPelaAgenda(page: Page, cliente: string) {
  await page.goto("/agenda?v=lista");
  await page.getByTestId("agenda-item").filter({ hasText: cliente }).locator('button[aria-haspopup="dialog"]').first().click();
  await page.getByRole("dialog", { name: cliente }).getByRole("button", { name: "Ver comanda" }).click();
  const comanda = page.getByRole("dialog", { name: new RegExp(`^Comanda \\d+ · ${cliente}$`) });
  await expect(comanda.getByRole("region", { name: "Itens" })).toBeVisible();
  return comanda;
}

/** Recebe uma forma e espera a linha do pagamento aparecer (o valor volta ao restante a cada recarga). */
async function receber(comanda: Locator, forma: string, valor: string, titulo: string, bandeira?: string) {
  await comanda.getByRole("radio", { name: forma, exact: true }).click();
  if (bandeira) await comanda.getByRole("radio", { name: bandeira, exact: true }).click();
  await comanda.getByLabel("Valor recebido (R$)").fill(valor);
  await comanda.getByRole("button", { name: /^Receber/ }).click(); // "Receber e fechar" quando completa o total (psico r68 #4)
  await expect(comanda.getByText(titulo, { exact: true })).toBeVisible();
}

test.beforeEach(prepara);
test.afterAll(limpa);

test("Fase A: taxa do cartão, assistente, dívida, vale, pagar a comissão com recibo, recibo no app e Exceções", async ({ page, isMobile }) => {
  test.setTimeout(240_000);
  const sufixo = isMobile ? "-celular" : "";
  await horario("Clara Corte", "+5571988775101", "Maiara", "Corte", 12000, agoraHM());
  await horario("Duda Divida", "+5571988775102", "Bia", "Hidratação", 9000, agoraHM());

  // 1. A gestão cadastra a taxa Visa (crédito à vista) em Serviços e pacotes › Formas de pagamento.
  await login(page);
  await page.goto("/servicos?aba=formas");
  const taxas = page.getByRole("region", { name: "Taxas do cartão" });
  await taxas.getByLabel("Visa Crédito à vista").fill("2,43");
  await taxas.getByLabel("Visa Crédito à vista").press("Tab");
  await expect(page.getByText("Taxa salva")).toBeVisible();
  expect(await e2eSql("select method, brand, parcelado, fee_bp from payment_fees")).toEqual([{ method: "credito", brand: "visa", parcelado: false, fee_bp: 243 }]);
  await shot(page, `fase-a-taxas-do-cartao${sufixo}`, { fullPage: true });

  // 2. A recepção abre o caixa e a comanda do Corte da Maiara: a Sidney já vem como assistente; R$ 120 no crédito Visa.
  await abreCaixaDaAna(page);
  const c1 = await comandaPelaAgenda(page, "Clara Corte");
  await expect(c1.getByRole("group", { name: "Assistentes de Corte" })).toContainText("Sidney");
  await receber(c1, "Crédito", "120", "Crédito · Visa", "Visa"); // completa o total: fecha junto
  await expect(page.getByText(/no Crédito · comanda \d+ fechada$/)).toBeVisible();
  const resumo = c1.getByRole("region", { name: "Pagamento" }).locator("dl");
  await expect(resumo).toContainText(/Taxas do cartão\s*R\$\s2,92/);
  await expect(resumo).toContainText(/Líquido\s*R\$\s117,08/);
  await expect(c1.getByText(/^taxa R\$\s2,92$/)).toBeVisible();
  await shot(page, `fase-a-comanda-assistente-taxa${sufixo}`);
  await expect(c1.getByText("Maiara com Sidney")).toBeVisible();
  const [pg] = await e2eSql("select fee_bp, fee_cents from comanda_payments where method = 'credito'");
  expect(pg).toEqual({ fee_bp: 243, fee_cents: 292 });
  await page.keyboard.press("Escape");

  // 3. Outra comanda: troca a profissional (Bia → Carla, vira exceção), recebe R$ 50 no Pix e deixa R$ 40 como dívida.
  const c2 = await comandaPelaAgenda(page, "Duda Divida");
  await c2.getByLabel("Profissional de Hidratação").selectOption({ label: "Carla" });
  await expect(c2.getByLabel("Profissional de Hidratação")).toHaveValue(await id("select id from professionals where name = 'Carla'"));
  await receber(c2, "Pix", "50", "Pix");
  await c2.getByLabel(/^Deixar R\$\s40 como dívida$/).check();
  await shot(page, `fase-a-deixar-como-divida${sufixo}`);
  await c2.getByRole("button", { name: "Fechar comanda" }).click();
  await expect(page.getByText(/^Comanda \d+ fechada$/)).toBeVisible();
  await expect(c2.getByText(/^Ficou R\$\s40 de dívida\.$/)).toBeVisible();
  expect((await e2eSql("select debt_cents from comandas where client_name = 'Duda Divida'"))[0].debt_cents).toBe(4000);
  await page.keyboard.press("Escape");

  // 4. A gestão lança um vale de R$ 50 para a Maiara em Comissão › Lançamentos (no fim do mês passado: o último período fechado dela).
  const { inicio, fim } = mesPassado();
  await login(page);
  await page.goto(`/caixa/comissao?aba=lancamentos&de=${inicio}&ate=${hoje()}`);
  const novo = page.getByRole("region", { name: "Novo lançamento" });
  await novo.getByRole("radio", { name: "Vale", exact: true }).click();
  await novo.getByLabel("Profissional").selectOption({ label: "Maiara" });
  await novo.getByLabel("Valor (R$)").fill("50");
  await novo.getByLabel("Data").fill(fim);
  await novo.getByLabel("Motivo").fill("adiantamento");
  await novo.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByText("Lançado", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lançamentos do período" })).toContainText(`Maiara · Vale · ${fim.split("-").reverse().join("/")}`);
  await shot(page, `fase-a-lancamentos-vale${sufixo}`, { fullPage: true });

  // 5. A pagar: a Maiara aparece até o fim do mês passado; "Até" hoje traz o Corte de hoje; paga e abre o recibo.
  await page.goto("/caixa/comissao?aba=apagar");
  const aPagar = page.getByRole("list", { name: "A pagar" });
  await expect(aPagar.getByRole("listitem").filter({ hasText: "Maiara" })).toContainText(`até ${fim.split("-").reverse().join("/")}`);
  await shot(page, `fase-a-a-pagar${sufixo}`);
  await aPagar.getByRole("button", { name: "Pagar Maiara" }).click();
  const folha = page.getByRole("dialog", { name: "Pagar a comissão de Maiara" });
  await folha.getByLabel("Até").fill(hoje());
  const previa = folha.getByRole("region", { name: "Recibo (prévia)" });
  await expect(previa.getByRole("region", { name: "Comissões" })).toContainText("Corte");
  await expect(previa).toContainText(/Vale/);
  await shot(page, `fase-a-pagar-previa${sufixo}`);
  await folha.getByRole("button", { name: "Confirmar pagamento" }).click();
  await expect(page).toHaveURL(/\/caixa\/comissao\/recibo\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: /^Recibo nº \d+$/ })).toBeVisible();
  // Corte R$ 120: base 120 − 2,92 (taxa, "antes") − 8,40 (antecipação 7% do crédito, "antes") = 108,68; 60% = 65,21; menos 10% da Sidney
  // (10,87, sai da principal) = 54,34. Menos o vale de 50 = 4,34.
  await expect(page.getByRole("main")).toContainText(/Comissões\s*R\$\s54,34/);
  await expect(page.getByRole("main")).toContainText(/Vales\s*−\s*R\$\s50,00/);
  await expect(page.getByRole("main")).toContainText(/Total pago\s*R\$\s4,34/);
  const [recibo] = await e2eSql("select number from commission_payouts where professional_id = (select id from professionals where name = 'Maiara')");
  await shot(page, `fase-a-recibo${sufixo}`, { fullPage: true });

  // 6. A Maiara vê o recibo no app (Ganhos).
  await login(page, "maiara@e2e.local");
  await page.goto("/pro/ganhos");
  const recibos = page.getByRole("region", { name: "Recibos" });
  await expect(recibos.getByRole("link", { name: new RegExp(`^Recibo nº ${recibo.number} · `) })).toBeVisible();
  await shot(page, `fase-a-pro-ganhos-recibos${sufixo}`, { fullPage: true });
  await recibos.getByRole("link", { name: new RegExp(`^Recibo nº ${recibo.number} · `) }).click();
  await expect(page.getByRole("heading", { name: `Recibo nº ${recibo.number}` })).toBeVisible();
  await shot(page, `fase-a-pro-recibo${sufixo}`, { fullPage: true });

  // 7. Relatórios › Financeiro: "Líquido no CRM"; "Ver todas" abre as Exceções (com a profissional trocada).
  await login(page);
  await page.goto("/relatorios?aba=financeiro");
  await expect(page.getByText("Líquido no CRM")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exceções" })).toBeVisible();
  await shot(page, `fase-a-financeiro${sufixo}`, { fullPage: true });
  await page.getByRole("link", { name: "Ver todas" }).click();
  await expect(page).toHaveURL(/\/relatorios\/excecoes\?/);
  // No computador é a tabela; no celular, a lista de cartões (DataList).
  const linha = page.getByRole(isMobile ? "list" : "table", { name: "Exceções" }).getByRole(isMobile ? "listitem" : "row").filter({ hasText: "Duda Divida" });
  await expect(linha).toContainText("Profissional diferente da agenda");
  await expect(linha).toContainText("Agenda: Bia · Comanda: Carla");
  await shot(page, `fase-a-excecoes${sufixo}`, { fullPage: true });
});

test("liga/desliga: com a Taxa do cartão desligada em Configurações › Caixa, o crédito novo entra sem taxa", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const sufixo = isMobile ? "-celular" : "";
  await e2eSql("insert into payment_fees (method, brand, parcelado, fee_bp) values ('credito', 'visa', false, 243)");

  // A gestão desliga "Taxa do cartão" em Configurações › Caixa ("O que o caixa usa").
  await login(page);
  await page.goto("/config/caixa");
  await expect(page.getByRole("heading", { name: "O que o caixa usa" })).toBeVisible();
  await shot(page, `fase-a-config-caixa${sufixo}`, { fullPage: true });
  const chave = page.getByRole("switch", { name: "Taxa do cartão" });
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await recursos(page).getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await e2eSql("select value->>'taxaCartao' as v from settings where key = 'caixa_recursos'"))[0]?.v).toBe("false");

  // A recepção recebe R$ 50 no crédito Visa numa comanda nova: nada de "Taxas do cartão" nem "Líquido".
  const ana = await id("select id from users where email = 'ana@e2e.local'");
  const c = await id("insert into comandas (day, number, client_name, opened_by) values ($1, 950, 'Liga Desliga', $2) returning id", [hoje(), ana]);
  await e2eSql(`insert into comanda_items (comanda_id, kind, label, qty, unit_cents, original_unit_cents, fiscal_kind, added_by)
    values ($1, 'produto', 'Kit', 1, 5000, 5000, 'produto', $2)`, [c, ana]);
  await abreCaixaDaAna(page);
  await page.getByRole("region", { name: "A receber" }).getByRole("button", { name: "Comanda 950 · Liga Desliga" }).click();
  const comanda = page.getByRole(isMobile ? "dialog" : "region", { name: "Comanda 950 · Liga Desliga" });
  await receber(comanda, "Crédito", "50", "Crédito · Visa", "Visa");
  await expect(comanda.getByText("Taxas do cartão")).toHaveCount(0);
  await expect(comanda.getByText("Líquido", { exact: true })).toHaveCount(0);
  await expect(comanda.getByText(/^Sem taxa cadastrada/)).toHaveCount(0);
  expect((await e2eSql("select fee_bp, fee_cents from comanda_payments where comanda_id = $1", [c]))[0]).toEqual({ fee_bp: null, fee_cents: null });
  await shot(page, `fase-a-taxa-desligada${sufixo}`);

  // Religa pela tela.
  await login(page);
  await page.goto("/config/caixa");
  await page.getByRole("switch", { name: "Taxa do cartão" }).click();
  await expect(page.getByRole("switch", { name: "Taxa do cartão" })).toHaveAttribute("aria-checked", "true");
  await recursos(page).getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await e2eSql("select value->>'taxaCartao' as v from settings where key = 'caixa_recursos'"))[0]?.v).toBe("true");
});
