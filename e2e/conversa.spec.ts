import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot } from "./helpers";

/** Deixa só os leads do prefixo na Fila (os outros specs deixam leads para trás) e devolve o id de cada telefone. */
async function isola(prefixo: string) {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${prefixo}%`]);
}
const leadId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [phone]))[0].id);
const stageOf = async (phone: string) => String((await e2eSql("select s.key from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id where c.phone_e164 = $1 and d.archived_at is null", [phone]))[0].key);

/** Dois leads esperando: Bianca (a mais antiga) e Cíntia. Cada teste usa o seu par de números, para não herdar conversa dos outros. */
async function dois(page: Page, k: number) {
  await isola(`+557199730${k}`);
  const fone = (n: number) => `71 99730-${k}00${n}`;
  const e164 = (n: number) => `+557199730${k}00${n}`;
  await simulate(page, { phone: fone(1), name: "Bianca Teles", text: "Oi, vocês fazem progressiva?" });
  await simulate(page, { phone: fone(2), name: "Cíntia Barreto", text: "Bom dia! Quanto custa o corte?" });
  await e2eSql("update deals set awaiting_reply_since = now() - interval '6 minutes' where contact_id = (select id from contacts where phone_e164 = $1)", [e164(1)]);
  await e2eSql("update deals set awaiting_reply_since = now() - interval '3 minutes' where contact_id = (select id from contacts where phone_e164 = $1)", [e164(2)]);
  return { bianca: e164(1), cintia: e164(2) };
}

/** Erros do navegador (hidratação, exceções): a conversa não pode gerar nenhum. */
function errosDoNavegador(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  return erros;
}

test("fila (desktop): responder pela conversa move para Atendimento, oferece o próximo e termina com Fila em dia", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const fones = await dois(page, 1);
  const bianca = await leadId(fones.bianca);
  await page.goto(`/atendimento?lead=${bianca}`);
  const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
  await expect(lead).toBeVisible();
  await expect(lead.getByText("Oi, vocês fazem progressiva?")).toBeVisible();
  expect(await stageOf(fones.bianca)).toBe("lead");

  const campo = lead.getByLabel("Mensagem");
  await campo.fill("Oi, Bianca! Fazemos sim. Quer vir amanhã?");
  await campo.press("Enter");
  await expect(campo).toHaveValue("");
  await expect(lead.getByText("Oi, Bianca! Fazemos sim.")).toBeVisible();
  // Responder move Lead para Atendimento e quem responde assume o lead
  await expect.poll(() => stageOf(fones.bianca)).toBe("atendimento");
  const [row] = await e2eSql("select d.awaiting_reply_since, d.owner_id from deals d where d.id = $1", [bianca]);
  expect(row.awaiting_reply_since).toBeNull();
  expect(row.owner_id).not.toBeNull();
  await expect(lead.getByRole("list", { name: "Etapas" }).locator('[aria-current="step"]')).toContainText("Atendimento");

  // "Próximo da fila" leva a quem espera há mais tempo, sem o lead atual
  const proximo = lead.getByRole("button", { name: /Próximo da fila/ });
  await expect(proximo).toBeVisible();
  await expect(proximo).toContainText("Cíntia Barreto");
  await shot(page, "03-proximo-da-fila-desktop");
  await proximo.click();
  const cintia = await leadId(fones.cintia);
  await expect(page).toHaveURL(new RegExp(`lead=${cintia}`));
  const lead2 = page.getByRole("region", { name: /Lead Cíntia Barreto/ });
  await expect(lead2).toBeVisible();
  await expect(page.getByRole("option", { name: /Cíntia Barreto/ })).toHaveAttribute("aria-selected", "true");
  await expect(lead2.getByRole("button", { name: /Próximo da fila/ })).toHaveCount(0); // o botão é de quem acabou de responder

  // Sem mais ninguém esperando
  await lead2.getByLabel("Mensagem").fill("Bom dia, Cíntia! O corte é R$ 90.");
  await lead2.getByLabel("Mensagem").press("Enter");
  await expect(lead2.getByRole("status").filter({ hasText: "Fila em dia" })).toBeVisible();
  await expect(lead2.getByRole("button", { name: /Próximo da fila/ })).toHaveCount(0);
  expect(await stageOf(fones.cintia)).toBe("atendimento");
  expect(erros, "erros do navegador").toEqual([]);
});

test("fila (desktop): abre na hora com os dados do item e a conversa chega depois", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await dois(page, 2);
  await page.goto("/atendimento");
  await expect(page.getByRole("option", { name: /Cíntia Barreto/ })).toBeVisible();
  // Segura as Server Actions: o que aparece antes delas vem do item da Fila
  let solta: () => void = () => {};
  const barreira = new Promise<void>((r) => { solta = r; });
  await page.route("**/atendimento**", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await barreira;
    await route.continue();
  });
  await page.getByRole("option", { name: /Cíntia Barreto/ }).click();
  const lead = page.getByRole("region", { name: /Lead Cíntia Barreto/ });
  await expect(lead).toBeVisible({ timeout: 1500 });
  await expect(lead.getByText("Bom dia! Quanto custa o corte?")).toBeVisible(); // última mensagem do item
  await expect(lead.getByRole("log", { name: "Mensagens" })).toHaveAttribute("aria-busy", "true"); // esqueleto do histórico
  await shot(page, "04-abertura-instantanea-desktop");
  solta();
  await expect(lead.getByRole("log", { name: "Mensagens" })).not.toHaveAttribute("aria-busy", "true");
  await expect(lead.getByRole("list", { name: "Etapas" })).toBeVisible();
});

test("conversa: abre no fim, mensagem nova com a pessoa lá em cima vira aviso e descer limpa o aviso", async ({ page, browser, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997202");
  await simulate(page, { phone: "71 99720-2001", name: "Heloísa Prado", text: "Primeira mensagem" });
  await e2eSql(`insert into messages (deal_id, contact_id, direction, kind, body, status, created_at)
    select d.id, d.contact_id, case when g % 2 = 0 then 'in'::direction else 'out'::direction end, 'text', 'Mensagem de teste número ' || g, 'sent', now() - make_interval(mins => 200 - g)
    from deals d join contacts c on c.id = d.contact_id, generate_series(1, 60) g where c.phone_e164 = '+5571997202001'`);
  const id = await leadId("+5571997202001");
  await page.goto(`/atendimento?lead=${id}`);
  const log = page.getByRole("log", { name: "Mensagens" });
  await expect(log.getByText("Mensagem de teste número 1", { exact: true })).toBeAttached(); // o histórico chegou (o esqueleto só tem a última)
  const noFim = () => log.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) <= 2);
  await expect.poll(noFim).toBe(true);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);

  // Mensagem nova com a pessoa no fim: desce junto, sem aviso. Sem esperar o segundo seguinte: no mesmo segundo do WhatsApp, a mensagem
  // ao vivo leva a hora de chegada em ms e o servidor desempata pelo id (webhook.ts messageTime, queries/deal.ts).
  const outra = await (await browser.newContext({ baseURL: "http://localhost:3100", storageState: "e2e/.auth/gestao.json" })).newPage();
  await simulate(outra, { phone: "71 99720-2001", name: "Heloísa Prado", text: "Chegou uma nova" });
  await expect(log.getByText("Chegou uma nova")).toBeVisible();
  await expect.poll(noFim).toBe(true);
  await expect(page.getByRole("button", { name: /nova mensagem|novas mensagens/ })).toHaveCount(0);

  // Rolou para cima: o aviso aparece e descer o limpa
  await log.evaluate((el) => { el.scrollTop = 0; });
  await simulate(outra, { phone: "71 99720-2001", name: "Heloísa Prado", text: "Mais uma, lá embaixo" });
  const aviso = page.getByRole("button", { name: "1 nova mensagem" });
  await expect(aviso).toBeVisible();
  expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(50); // não puxou a leitura
  await shot(page, "05-aviso-nova-mensagem-desktop");
  await aviso.click();
  await expect(aviso).toHaveCount(0);
  await expect.poll(noFim).toBe(true);
  await expect(log.getByText("Mais uma, lá embaixo")).toBeInViewport();
  await outra.context().close();
});

test.describe("celular: conversa em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });
  test("cabeçalho de uma linha, composer sempre à vista e o teclado não cobre o Enviar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const erros = errosDoNavegador(page);
    await login(page);
    const fones = await dois(page, 3);
    const id = await leadId(fones.bianca);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
    await expect(lead).toBeVisible();
    await expect(lead.getByRole("button", { name: "Agendar" })).toBeHidden(); // as ações moram no menu ⋯ (e na aba Dados)
    const vp = page.viewportSize()!;

    // Conversa em tela cheia: sem barra de navegação inferior nem barra superior do app
    await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Casa\s*Fiaes/ })).toHaveCount(0);

    // Cabeçalho compacto: voltar, nome, SLA e ⋯ em uma linha
    const voltar = lead.getByRole("link", { name: "Voltar para a fila" });
    const mais = lead.getByRole("button", { name: "Mais ações" });
    await expect(voltar).toBeVisible();
    await expect(mais).toBeVisible();
    const nome = lead.getByRole("heading", { name: "Bianca Teles" });
    const caixa = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!;
    const v = await caixa(voltar), n = await caixa(nome), m = await caixa(mais);
    expect(Math.abs((v.y + v.height / 2) - (n.y + n.height / 2))).toBeLessThan(8);
    expect(Math.abs((m.y + m.height / 2) - (n.y + n.height / 2))).toBeLessThan(8);
    expect(v.height).toBeGreaterThanOrEqual(44);
    expect(m.height).toBeGreaterThanOrEqual(44);
    await expect(lead.getByText(/\d+ (s|min)/).first()).toBeVisible(); // SLA
    const tabs = await caixa(lead.getByRole("tablist"));
    expect(tabs.y + tabs.height - (await caixa(voltar)).y).toBeLessThan(vp.height * 0.2); // o cabeçalho não ocupa metade da tela

    // Composer à vista sem rolar, dentro do viewport
    const enviar = lead.getByRole("button", { name: /^(Enviar|Gravar áudio)$/ });
    const campo = lead.getByLabel("Mensagem");
    await expect(enviar).toBeInViewport({ ratio: 1 });
    await expect(campo).toBeInViewport({ ratio: 1 });
    const env = await caixa(enviar);
    expect(env.height).toBeGreaterThanOrEqual(44);
    expect(vp.height - (env.y + env.height), "o Enviar encosta no fundo (sem notch)").toBeLessThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(vp.height); // a página não rola
    expect(await campo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "06-celular-conversa-composer-390");

    // Teclado aberto = viewport bem mais baixo: o composer segue inteiro na tela
    await page.setViewportSize({ width: vp.width, height: 460 });
    await campo.fill("Oi, Bianca!");
    await expect(enviar).toBeInViewport({ ratio: 1 });
    await expect(campo).toBeInViewport({ ratio: 1 });
    await page.setViewportSize(vp);

    // Menu ⋯ guarda as ações
    await mais.click();
    for (const nomeItem of ["Agendar", "Perdido", "Ligar", "WhatsApp"]) await expect(page.getByRole("menuitem", { name: nomeItem })).toBeVisible();
    for (const it of await page.getByRole("menuitem").all()) expect((await it.boundingBox())!.height).toBeGreaterThanOrEqual(43.9); // 44 px, com folga de subpixel
    await page.keyboard.press("Escape");

    // Responder oferece o próximo e leva à conversa dele em tela cheia
    await campo.press("Enter");
    const proximo = lead.getByRole("button", { name: /Próximo da fila/ });
    await expect(proximo).toBeVisible();
    await expect(proximo).toContainText("Cíntia Barreto");
    expect((await caixa(proximo)).height).toBeGreaterThanOrEqual(44);
    await expect(proximo).toBeInViewport({ ratio: 1 });
    await shot(page, "07-celular-proximo-da-fila-390");
    await proximo.click();
    const cintia = await leadId(fones.cintia);
    await expect(page).toHaveURL(new RegExp(`/atendimento/${cintia}$`));
    await expect(page.getByRole("region", { name: /Lead Cíntia Barreto/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(erros, "erros do navegador (inclui hidratação)").toEqual([]);
  });

  test("tocar numa conversa da lista já troca a tela, com o cabeçalho e a última mensagem, enquanto o servidor responde", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    await dois(page, 4);
    await page.goto("/atendimento");
    await expect(page.getByRole("option", { name: /Cíntia Barreto/ })).toBeVisible();
    let solta: () => void = () => {};
    const barreira = new Promise<void>((r) => { solta = r; });
    await page.route(/\/atendimento\/[0-9a-f-]{36}(\?|$)/, async (route) => {
      if (route.request().headers()["rsc"]) await barreira; // a navegação do Next pede o RSC da rota
      await route.continue();
    });
    await page.getByRole("option", { name: /Cíntia Barreto/ }).tap();
    await expect(page.getByRole("heading", { name: "Cíntia Barreto" })).toBeVisible({ timeout: 1500 });
    await expect(page.getByRole("log", { name: "Mensagens" }).getByText("Bom dia! Quanto custa o corte?")).toBeVisible();
    await expect(page.getByRole("log", { name: "Mensagens" })).toHaveAttribute("aria-busy", "true");
    solta();
    await expect(page.getByRole("region", { name: /Lead Cíntia Barreto/ })).toBeVisible();
    await expect(page.getByRole("log", { name: "Mensagens" })).not.toHaveAttribute("aria-busy", "true");
  });
});
