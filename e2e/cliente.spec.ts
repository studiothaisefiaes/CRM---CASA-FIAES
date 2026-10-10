import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, simulate, e2eSql, shot } from "./helpers";

/** Deixa só os leads do prefixo na Fila (os outros specs deixam leads para trás). */
async function isola(prefixo: string) {
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
  await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id not in (select id from contacts where phone_e164 like $1)", [`${prefixo}%`]);
}
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

test("painel do cliente (desktop): identidade, situação, por que está esperando, ações e etapas, com a origem real", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const id = await umLead(page, 1);
  await page.goto(`/atendimento?lead=${id}`);
  const p = painel(page);
  await expect(p.getByRole("heading", { name: "Bianca Teles" })).toBeVisible();
  // Por que está esperando: a linha do whyLate, com o prazo da etapa
  await expect(p.getByTestId("por-que-atrasou")).toContainText(/Cliente escreveu às \d{2}:\d{2} e ninguém respondeu \(\d+ min no expediente; prazo 2 min\)/);
  // Origem: a mesma da Fila ("Não identificada"), nunca o canal
  await expect(p.getByRole("term").filter({ hasText: "Origem" })).toBeVisible();
  await expect(p.getByText("Não identificada").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Origem" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Origem" }).locator("option", { hasText: "WhatsApp" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Lead Bianca Teles/ }).locator("p", { hasText: "Não identificada" }).first()).toBeVisible(); // o cabeçalho diz o mesmo
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toContainText("Não identificada"); // e a Fila também
  // Etapas: Follow-up agrupado, tocável
  const etapas = p.getByRole("list", { name: "Etapas" });
  await expect(etapas.getByRole("listitem")).toHaveText(["Lead (etapa atual)", "Atendimento", "Agendado", "Follow-up", "Fechado", "Perdido"]);
  await expect(etapas.locator('[aria-current="step"]')).toContainText("Lead");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
  await shot(page, "01-painel-desktop-1440");
  expect(erros, "erros do navegador").toEqual([]);
});

test("etapas: tocar muda a etapa (com auditoria) e Agendado, Fechado e Perdido abrem a folha que pede o que falta", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 2);
  await page.goto(`/atendimento?lead=${id}`);
  const etapas = painel(page).getByRole("list", { name: "Etapas" });

  await etapas.getByRole("button", { name: "Mover para Atendimento" }).click();
  await expect(etapas.locator('[aria-current="step"]')).toContainText("Atendimento");
  expect((await deal(id)).stage_key).toBe("atendimento");
  const mov = await eventos(id, "etapa_alterada");
  expect(mov.at(-1)?.payload).toMatchObject({ de: "lead", para: "atendimento", motivo: "manual" });
  expect(mov.at(-1)?.user_id).not.toBeNull();

  await etapas.getByRole("button", { name: "Mover para Follow-up" }).click();
  await expect(etapas.locator('[aria-current="step"]')).toContainText("Follow-up 1");
  expect((await deal(id)).stage_key).toBe("followup_1");

  // As três etapas que pedem dados abrem a folha e, cancelando, nada muda
  for (const [etapa, folha] of [["Agendado", "Agendar avaliação"], ["Fechado", "Fechar venda"], ["Perdido", "Marcar como perdido"]] as const) {
    await etapas.getByRole("button", { name: `Mover para ${etapa}` }).click();
    const dlg = page.getByRole("dialog", { name: folha });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    await expect(dlg).toHaveCount(0);
    expect((await deal(id)).stage_key).toBe("followup_1");
  }
});

test("fechar venda em 4 toques: pagamento, serviço e valor em reais, sem duplicar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros = errosDoNavegador(page);
  await login(page);
  const id = await umLead(page, 3);
  await noEstagio(id, "agendado");
  await page.goto(`/atendimento?lead=${id}`);
  let toques = 0;
  const toca = async (l: Locator) => { toques++; await l.click(); };

  await toca(painel(page).getByRole("button", { name: "Fechar venda" })); // 1
  const dlg = page.getByRole("dialog", { name: "Fechar venda" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel("Valor")).toBeFocused(); // o cursor já está no valor (teclado numérico)
  expect(await dlg.getByLabel("Valor").getAttribute("inputmode")).toBe("decimal");
  await expect(dlg.getByRole("radio", { name: "Sim" })).toBeChecked(); // "Pago agora?" vem em Sim

  // Sem nada preenchido, explica o que falta e não fecha
  await dlg.getByRole("button", { name: "Fechar venda" }).click();
  await expect(dlg.getByRole("alert").filter({ hasText: "Digite o valor da venda" })).toBeVisible();
  await expect(dlg.getByRole("alert").filter({ hasText: "Escolha a forma de pagamento." })).toBeVisible();
  await expect(dlg.getByRole("alert").filter({ hasText: "Escolha o serviço." })).toBeVisible();
  expect((await deal(id)).stage_key).toBe("agendado");

  await dlg.getByLabel("Valor").fill("1158.50"); // digitar não é toque: o campo já estava com o cursor
  await expect(dlg.getByText("R$ 1.158,50")).toBeVisible(); // formatado ao vivo
  await toca(dlg.getByRole("radio", { name: "Pix" })); // 2
  await toca(dlg.getByRole("radio", { name: "Coloração" })); // 3
  await shot(page, "02-fechar-venda-sheet-desktop");
  await toca(dlg.getByRole("button", { name: "Fechar venda" })); // 4
  expect(toques).toBe(4);

  await expect(page.getByRole("status").filter({ hasText: "Venda fechada · R$ 1.158,50" })).toBeVisible();
  await expect(dlg).toHaveCount(0);
  const d = await deal(id);
  expect(d.stage_key).toBe("fechado");
  expect(d.value_cents).toBe(115850);
  expect(d.payment_method).toBe("pix");
  expect(d.paid_at).not.toBeNull();
  expect(d.paid_cents).toBe(115850);
  expect(String((await e2eSql("select label from lists where id = $1", [d.service_id]))[0].label)).toBe("Coloração");
  expect(await eventos(id, "venda")).toHaveLength(1);
  // O painel acompanha: situação com a venda e etapa atual Fechado
  await expect(painel(page).getByText("Venda fechada · R$ 1.158,50")).toBeVisible();
  await expect(painel(page).getByRole("list", { name: "Etapas" }).locator('[aria-current="step"]')).toContainText("Fechado");
  expect(erros, "erros do navegador").toEqual([]);
});

test("fechar venda: se outra pessoa já fechou, avisa e não duplica", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 4);
  await noEstagio(id, "agendado");
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: "Fechar venda" }).click();
  const dlg = page.getByRole("dialog", { name: "Fechar venda" });
  await dlg.getByLabel("Valor").fill("90");
  await dlg.getByRole("radio", { name: "Cartão" }).click();
  await dlg.getByRole("radio", { name: "Corte" }).click();
  await noEstagio(id, "fechado"); // a colega fechou enquanto esta folha estava aberta
  await dlg.getByRole("button", { name: "Fechar venda" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Essa venda já estava fechada" })).toBeVisible();
  expect(await eventos(id, "venda")).toHaveLength(0);
  expect((await deal(id)).value_cents).toBeNull();
});

test("Não é cliente arquiva e o Desfazer devolve o lead", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 5);
  await page.goto(`/atendimento?lead=${id}`);
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toBeVisible();
  await painel(page).getByRole("button", { name: "Não é cliente" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Bianca Teles saiu da fila" })).toBeVisible();
  await expect(page).not.toHaveURL(/lead=/);
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toHaveCount(0);
  expect((await deal(id)).archived_at).not.toBeNull();
  expect((await e2eSql("select ignored from contacts where phone_e164 = '+5571997405001'"))[0].ignored).toBe(true);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("region", { name: /Lead Bianca Teles/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toBeVisible();
  const d = await deal(id);
  expect(d.archived_at).toBeNull();
  expect(d.stage_key).toBe("lead");
  expect((await e2eSql("select ignored from contacts where phone_e164 = '+5571997405001'"))[0].ignored).toBe(false);
  expect((await eventos(id, "restaurado"))).toHaveLength(1);
});

test("Assumir troca o dono exibido; a gestão transfere; a atendente não vê Transferir", async ({ page, browser, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 6);
  await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  const dono = painel(page).getByTestId("responsavel");
  await expect(dono).toHaveText("Ana Souza");

  await painel(page).getByRole("button", { name: "Assumir" }).click();
  await expect(dono).toHaveText("Thaíse Fiaes");
  await expect(painel(page).getByRole("button", { name: "Assumir" })).toHaveCount(0); // já é meu
  expect((await deal(id)).owner_email).toBe("gestao@e2e.local");
  const assumiu = await eventos(id, "assumiu");
  expect(assumiu).toHaveLength(1);
  expect(assumiu[0].payload).toMatchObject({ para: expect.any(String) });

  // A gestão transfere para outra pessoa
  await painel(page).getByRole("button", { name: "Transferir para…" }).click();
  await page.getByRole("menuitem", { name: "Ana Souza" }).click();
  await expect(dono).toHaveText("Ana Souza");
  expect((await deal(id)).owner_email).toBe("ana@e2e.local");
  expect(await eventos(id, "responsavel_alterado")).toHaveLength(1);

  // Atendente: o lead é de outra pessoa → Assumir; sem Transferir
  await e2eSql("update deals set owner_id = (select id from users where email = 'gestao@e2e.local') where id = $1", [id]);
  const ctx = await browser.newContext({ baseURL: "http://localhost:3100", storageState: "e2e/.auth/ana.json" });
  const ana = await ctx.newPage();
  await ana.goto(`/atendimento/${id}`);
  await expect(painel(ana).getByTestId("responsavel")).toHaveText("Thaíse Fiaes");
  await expect(painel(ana).getByRole("button", { name: "Transferir para…" })).toHaveCount(0);
  await painel(ana).getByRole("button", { name: "Assumir" }).click();
  await expect(painel(ana).getByTestId("responsavel")).toHaveText("Ana Souza");
  expect((await deal(id)).owner_email).toBe("ana@e2e.local");
  await ctx.close();
});

test("agendar valida: horário passado é erro; fora do expediente avisa e deixa agendar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 7);
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: "Agendar", exact: true }).click();
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
    await painel(page).getByRole("button", { name: "Agendar", exact: true }).click();
    const dlg2 = page.getByRole("dialog", { name: "Agendar avaliação" });
    await dlg2.getByLabel("Dia").fill(diaBahia(2));
    await dlg2.getByLabel("Hora").fill("15:00");
    await expect(dlg2.getByRole("status")).toContainText(/Fora do horário de atendimento \(\w+, das 8:00 às 9:00\)\. Dá para agendar mesmo assim\./);
    await shot(page, "03-agendar-fora-do-horario-desktop");
    await dlg2.getByRole("button", { name: "Agendar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Avaliação agendada" })).toBeVisible();
    const d = await deal(id);
    expect(d.stage_key).toBe("agendado");
    expect(new Date(d.scheduled_at as string).toISOString()).toBe(new Date(`${diaBahia(2)}T15:00:00-03:00`).toISOString());
    await expect(painel(page).getByText(/Agendado para .* às 15:00/)).toBeVisible();
    await expect(painel(page).getByRole("button", { name: "Remarcar" })).toBeVisible();
  } finally {
    await e2eSql("update settings set value = $1::jsonb where key = 'business_hours'", [JSON.stringify(original)]);
  }
});

test("perdido pede o motivo", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await umLead(page, 8);
  await page.goto(`/atendimento?lead=${id}`);
  await painel(page).getByRole("button", { name: "Perdido", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Marcar como perdido" });
  await dlg.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Escolha o motivo da perda.");
  expect((await deal(id)).stage_key).toBe("lead");

  await dlg.getByRole("radio", { name: "Preço" }).click();
  await dlg.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lead marcado como perdido" })).toBeVisible();
  const d = await deal(id);
  expect(d.stage_key).toBe("perdido");
  expect(String((await e2eSql("select label from lists where id = $1", [d.lost_reason_id]))[0].label)).toBe("Preço");
  await expect(painel(page).getByText("Perdido · Preço")).toBeVisible();
  // Auditoria de/para do motivo
  const campos = (await eventos(id, "campo_alterado")).flatMap((e) => (e.payload as { campos: { campo: string; de: unknown; para: unknown }[] }).campos);
  expect(campos).toContainEqual(expect.objectContaining({ campo: "lostReasonId", de: null, para: d.lost_reason_id }));
});

test.describe("celular: painel do cliente em 390 px", () => {
  test.use({ deviceScaleFactor: 2 });

  test("aba Dados com etapas, ações em 44 px e a folha de fechar venda subindo de baixo", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const erros = errosDoNavegador(page);
    await login(page);
    const id = await umLead(page, 1);
    await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
    await expect(lead).toBeVisible();
    await lead.getByRole("tab", { name: "Dados" }).click();
    const p = painel(page);
    await expect(p.getByRole("heading", { name: "Bianca Teles" })).toBeVisible();
    await expect(p.getByTestId("por-que-atrasou")).toBeVisible();
    for (const alvo of [p.getByRole("button", { name: "Assumir" }), p.getByRole("button", { name: "Agendar", exact: true }), p.getByRole("button", { name: "Perdido", exact: true }), p.getByRole("button", { name: "Não é cliente" }), p.getByRole("button", { name: "Mover para Atendimento" })]) {
      expect((await alvo.boundingBox())!.height, await alvo.innerText()).toBeGreaterThanOrEqual(43.9);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    await shot(page, "04-celular-aba-dados-390", { clip: { x: 0, y: 0, width: 390, height: 664 } });

    // Fechar venda: a folha sobe de baixo, o valor tem 16 px e teclado numérico
    await p.getByRole("button", { name: "Fechar venda" }).click();
    const dlg = page.getByRole("dialog", { name: "Fechar venda" });
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(500);
    const box = (await dlg.boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height); // colada embaixo
    const valor = dlg.getByLabel("Valor");
    expect(await valor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await valor.getAttribute("inputmode")).toBe("decimal");
    for (const chip of await dlg.getByRole("radio").all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await valor.fill("1158.50");
    await expect(dlg.getByText("R$ 1.158,50")).toBeVisible();
    await shot(page, "05-celular-fechar-venda-390");
    expect(erros, "erros do navegador").toEqual([]);
  });

  test("as ações também estão no menu ⋯ do cabeçalho", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const id = await umLead(page, 2);
    await e2eSql("update deals set owner_id = (select id from users where email = 'ana@e2e.local') where id = $1", [id]);
    await page.goto(`/atendimento/${id}`);
    const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
    await lead.getByRole("button", { name: "Mais ações" }).click();
    for (const item of ["Assumir", "Agendar", "Perdido", "Não é cliente"]) await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    await page.getByRole("menuitem", { name: "Assumir" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Agora o lead é seu" })).toBeVisible();
    await expect.poll(async () => (await deal(id)).owner_email).toBe("gestao@e2e.local");
    await lead.getByRole("button", { name: "Mais ações" }).click();
    await expect(page.getByRole("menuitem", { name: "Assumir" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Perdido" }).click();
    await expect(page.getByRole("dialog", { name: "Marcar como perdido" })).toBeVisible();
  });

  test("WhatsApp caído: aviso compacto no cabeçalho da conversa, com link para resolver", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    await login(page);
    const id = await umLead(page, 3);
    await e2eSql("insert into channels (name, instance_name, status) values ('Salão', 'e2e-aviso-celular', 'erro')");
    try {
      await page.goto(`/atendimento/${id}`);
      const lead = page.getByRole("region", { name: /Lead Bianca Teles/ });
      const aviso = lead.getByTestId("aviso-whatsapp");
      await expect(aviso).toContainText("WhatsApp desconectado");
      await expect(aviso).toHaveAttribute("href", "/config/whatsapp"); // gestão: vai para reconectar
      await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
      await shot(page, "06-celular-whatsapp-caido-390", { clip: { x: 0, y: 0, width: 390, height: 260 } });
      expect((await aviso.boundingBox())!.height).toBeLessThanOrEqual(40); // compacto: uma linha só
      // O cabeçalho continua compacto e nada rola para o lado
      const voltar = await lead.getByRole("link", { name: "Voltar para a fila" }).boundingBox();
      const mais = await lead.getByRole("button", { name: "Mais ações" }).boundingBox();
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
