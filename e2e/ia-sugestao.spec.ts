import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, isola, shot } from "./helpers";

/**
 * Sugestão de resposta por IA: o servidor do e2e usa chave falsa e um endereço morto (playwright.config): nada aqui fala com a Anthropic.
 * Abrir a conversa NÃO gera (só o botão "Sugerir resposta"); a sugestão de verdade é gravada direto
 * no banco, como o servidor faria. "Usar" só preenche a caixa: nada é enviado.
 */
const FONE = "71 99749-1001", E164 = "+5571997491001";
const ligar = (on: boolean) => e2eSql(`insert into settings (key, value) values ('ia_sugestao', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ enabled: on, monthlyLimitUsd: 40, dailyCalls: 1500 })]);
const dealOf = async () => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [E164]))[0].id);
const lastMsg = async (dealId: string) => String((await e2eSql("select id from messages where deal_id = $1 order by created_at desc, id desc limit 1", [dealId]))[0].id);
async function sugerir(dealId: string, s: { sugestao: string; resumo?: string; precisaHumano?: boolean; motivo?: string | null }) {
  const [r] = await e2eSql(`insert into ai_suggestions (deal_id, last_message_id, resumo, sugestao, precisa_humano, motivo, model, input_tokens, cached_tokens, output_tokens, cost_usd_micros, origin)
    values ($1, $2, $3, $4, $5, $6, 'claude-haiku-5-5', 900, 3000, 120, 180, 'outra') returning id`, [dealId, await lastMsg(dealId), s.resumo ?? "Quer saber o preço da escova.", s.sugestao, s.precisaHumano ?? false, s.motivo ?? null]);
  // O aviso que o worker manda depois de gravar (a conversa aberta atualiza sozinha).
  await e2eSql("select pg_notify('crm_events', $1)", [JSON.stringify({ type: "ia_sugestao", dealId })]);
  return String(r.id);
}
/** Linhas de sugestão da última mensagem da conversa (o mesmo número é usado nos 3 testes). */
const doUltimo = async (dealId: string) => (await e2eSql("select id from ai_suggestions where last_message_id = $1", [await lastMsg(dealId)])).length;
const outCount = async (dealId: string) => Number((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [dealId]))[0].n);
const outboxCount = async (dealId: string) => Number((await e2eSql("select count(*)::int as n from outbox where deal_id = $1", [dealId]))[0].n);

async function abrir(page: Page, antes?: (dealId: string) => Promise<unknown>) {
  await isola("+55719974910");
  await simulate(page, { phone: FONE, name: "Paula Reis", text: "Oi! Quanto custa a escova?" });
  const dealId = await dealOf();
  await antes?.(dealId);
  await page.goto(`/atendimento?lead=${dealId}`);
  const lead = page.getByRole("region", { name: /Conversa com Paula Reis/ });
  await expect(lead.getByText("Oi! Quanto custa a escova?")).toBeVisible();
  return { dealId, lead };
}

test.afterAll(async () => { await ligar(false); });

test("ia (desktop): abrir a conversa não gera, só mostra 'Sugerir resposta'; a sugestão chega ao vivo, 'Usar' só preenche a caixa e nada é enviado", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await ligar(true);
  await login(page);
  const { dealId, lead } = await abrir(page);
  const card = lead.getByRole("region", { name: "Sugestão da IA" });
  // Abrir não gera nada: só aparece o botão.
  await expect(lead.getByRole("button", { name: "Sugerir resposta" })).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveCount(0);
  expect(await doUltimo(dealId)).toBe(0);

  const id = await sugerir(dealId, { sugestao: "Oi, Paula! A escova fica R$ 80. Quer que eu veja um horário para você?" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Quer:")).toBeVisible();
  await expect(card.getByText("saber o preço da escova.")).toBeVisible();
  await expect(card.getByTestId("sugestao-ia")).toHaveText("Oi, Paula! A escova fica R$ 80. Quer que eu veja um horário para você?");
  await shot(page, "ia-sugestao-desktop");

  const antes = await outCount(dealId);
  await card.getByRole("button", { name: "Usar e editar" }).click();
  const campo = lead.getByRole("textbox", { name: "Mensagem", exact: true });
  await expect(campo).toHaveValue("Oi, Paula! A escova fica R$ 80. Quer que eu veja um horário para você?");
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await e2eSql("select used_at from ai_suggestions where id = $1", [id]))[0].used_at).not.toBeNull();
  // Nada saiu: nenhuma mensagem da Casa nova e nada na fila de envios, mesmo depois de um tempo.
  await page.waitForTimeout(1500);
  expect(await outCount(dealId)).toBe(antes);
  expect(await outboxCount(dealId)).toBe(0);
  // A atendente pode mudar o texto antes de enviar.
  await campo.fill("Oi, Paula! A escova é R$ 80. Prefere de manhã ou de tarde?");
  await campo.press("Enter");
  await expect(lead.getByText("Prefere de manhã ou de tarde?")).toBeVisible();
  // A Casa falou por último: o botão continua (a IA escreve a próxima mensagem da Casa), com o tema opcional ao lado.
  await expect(lead.getByRole("button", { name: "Sugerir resposta" })).toBeVisible({ timeout: 20_000 });
  await expect(lead.getByRole("textbox", { name: "Sobre o quê? (opcional)" })).toBeVisible();
});

test("ia (desktop): pede alguém da equipe mostra o motivo; X fecha; mensagem nova da cliente tira a sugestão; 'Outra' sem chave avisa", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await ligar(true);
  await login(page);
  // A sugestão já guardada para a mensagem é reaproveitada: abrir não gera outra.
  let id = "";
  const { dealId, lead } = await abrir(page, async (d) => { id = await sugerir(d, { sugestao: "Oi, Paula! Sinto muito. Vou ver com a gerente e já te respondo.", resumo: "Quer desconto no pacote.", precisaHumano: true, motivo: "Pediu desconto." }); });
  const card = lead.getByRole("region", { name: "Sugestão da IA" });
  await expect(card.getByRole("note")).toContainText("Pede alguém da equipe: Pediu desconto.");
  expect(await doUltimo(dealId)).toBe(1);
  // "Outra" sem a IA de verdade (endereço morto): avisa, a sugestão de antes continua e nada fica gravado.
  await card.getByRole("button", { name: "Outra" }).click();
  await expect(page.getByText("A IA não respondeu. Tente de novo em instantes.")).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId("sugestao-ia")).toContainText("Sinto muito");
  expect(await doUltimo(dealId)).toBe(1);
  await card.getByRole("button", { name: "Fechar a sugestão" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await e2eSql("select dismissed_at from ai_suggestions where id = $1", [id]))[0].dismissed_at).not.toBeNull();

  await sugerir(dealId, { sugestao: "Oi, Paula! Tudo bem?" });
  await expect(card).toBeVisible();
  await simulate(page, { phone: FONE, name: "Paula Reis", text: "E a hidratação?" });
  await page.goto(`/atendimento?lead=${dealId}`);
  await expect(lead.getByText("E a hidratação?")).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(lead.getByRole("button", { name: "Sugerir resposta" })).toBeVisible({ timeout: 20_000 });
});

test("ia (desktop): desligada (o padrão) não mostra nada; Configurações liga, mostra o gasto e os limites", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await ligar(false);
  await login(page);
  const { lead } = await abrir(page, (d) => sugerir(d, { sugestao: "Oi, Paula!" }));
  await page.waitForTimeout(1200);
  await expect(lead.getByRole("region", { name: "Sugestão da IA" })).toHaveCount(0);
  await expect(lead.getByRole("button", { name: "Sugerir resposta" })).toHaveCount(0);

  await page.goto("/config/ia");
  await expect(page.getByRole("heading", { level: 1, name: "Sugestão de resposta por IA" })).toBeVisible();
  await expect(page.getByText("A IA escreve uma sugestão; ninguém recebe nada sem a atendente enviar.").first()).toBeVisible();
  await expect(page.getByText(/neste mês, de US\$ 40,00/)).toBeVisible();
  const chave = page.getByRole("switch", { name: "Sugestão de resposta por IA" });
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await e2eSql("select value from settings where key = 'ia_sugestao'"))[0].value).toMatchObject({ enabled: true });
  await page.getByLabel("Limite do mês (US$)").fill("25");
  await page.getByRole("button", { name: "Salvar limites" }).click();
  await expect.poll(async () => (await e2eSql("select value from settings where key = 'ia_sugestao'"))[0].value).toMatchObject({ enabled: true, monthlyLimitUsd: 25 });
  await shot(page, "ia-config");

  // No índice de Configurações, em Conversas, com o estado.
  await page.goto("/config?grupo=conversas");
  await expect(page.getByRole("link", { name: /Sugestão de resposta por IA/ })).toContainText(/Ligada · US\$/);
});
