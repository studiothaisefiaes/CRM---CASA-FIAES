import { expect, test, type Page } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/**
 * Nova Agenda › Dia (aprovada pelo dono em 16/10), desktop e celular: fileira de fotos, arrastar um horário para outra profissional ou
 * hora (com confirmação, recusa e Desfazer), o "Mover…" do painel do horário, "Avisar a cliente" que só preenche a conversa, o
 * Personalizar com visão salva por pessoa e as pendências "sem baixa" em lote. O reset deixa o modo dupla, a Maiara e a Carla (9h–18h),
 * a Bia (Casa 24 h), Corte (60 min) e Hidratação (45 min) feitos pelas três.
 */
const OFFSET_MS = 3 * 3_600_000; // Salvador
const dia = (n: number) => new Date(Date.now() - OFFSET_MS + n * 86_400_000).toISOString().slice(0, 10);
const em = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).toISOString();
const proId = async (name: string) => String((await e2eSql("select id from professionals where name = $1", [name]))[0].id);
const serviceId = async (label: string) => String((await e2eSql("select id from lists where kind = 'service' and label = $1", [label]))[0].id);
async function cliente(name: string, phone: string, conversa = false) {
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [name, phone]);
  if (conversa) await e2eSql("insert into deals (contact_id, stage_id) select $1, (select id from stages where kind = 'agendado' limit 1) where not exists (select 1 from deals where contact_id = $1 and closed_at is null and archived_at is null)", [c.id]);
  return String(c.id);
}
async function horario(o: { contactId: string; name: string; pro: string; day: string; hm: string; status?: string; origin?: string }) {
  const [a] = await e2eSql(
    `insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, status, origin, external_key)
     values ($1, $2, $3, $4, 'Corte', $5, 60, $6, $7, 'e2e:nova:' || gen_random_uuid()) returning id`,
    [o.contactId, o.name, await proId(o.pro), await serviceId("Corte"), em(o.day, o.hm), o.status ?? "agendado", o.origin ?? "crm"]);
  return String(a.id);
}
const doHorario = async (id: string) => (await e2eSql("select a.status, a.starts_at, p.name as pro from appointments a left join professionals p on p.id = a.professional_id where a.id = $1", [id]))[0];
const card = (page: Page, nome: string) => page.locator(`[data-ev][aria-label*="${nome}"]`);
/** Abre o dia e espera a grade hidratar (antes disso o arrastar e o clique não têm quem responda). */
const abrirDia = async (page: Page, d: string) => { await page.goto(`/agenda?d=${d}`); await expect(page.locator("section[data-pronta]")).toBeVisible(); };
const celula = async (pro: string, hm: string) => `[data-coluna="${await proId(pro)}"] button[aria-label="Marcar com ${pro} às ${hm}"]`;

test.describe("Nova Agenda › Dia", () => {
  test.beforeEach(async ({ page }) => {
    await e2eSql("delete from pro_notifications");
    await e2eSql("delete from client_notes");
    await e2eSql("delete from client_links");
    await e2eSql("delete from appointments where external_key like 'e2e:nova:%' or origin = 'crm'");
    await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
    await e2eSql("delete from visits");
    await e2eSql("delete from agenda_blocks");
    await e2eSql("delete from user_preferences");
    await login(page);
  });

  test("arrastar para outra profissional: confirma 'Passar … para a Bia às 11:00?', grava e Desfazer volta", async ({ page, isMobile }) => {
    test.skip(isMobile, "arrastar é do computador; no celular é o Mover…");
    const rosa = await cliente("Rosa Arrasta", "+5571988775001");
    const id = await horario({ contactId: rosa, name: "Rosa Arrasta", pro: "Maiara", day: dia(1), hm: "10:00", origin: "avec" });
    await abrirDia(page, dia(1));
    await expect(card(page, "Rosa Arrasta")).toHaveAttribute("draggable", "true");
    await page.dragAndDrop(`[data-ev][aria-label*="Rosa Arrasta"]`, await celula("Bia", "11:00"));
    const dlg = page.getByRole("dialog", { name: "Passar Rosa para a Bia às 11:00?" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText("Este horário veio do Avec. Enquanto o Avec estiver ligado, mude também lá.")).toBeVisible(); // modo dupla
    await expect(dlg.getByRole("switch", { name: "Avisar a cliente" })).toHaveAttribute("aria-checked", "false"); // desligado por padrão
    await dlg.getByRole("button", { name: "Passar" }).click();
    await expect(page.getByText("Rosa passou para a Bia às 11:00. Mude também no Avec.")).toBeVisible();
    await expect.poll(async () => doHorario(id)).toMatchObject({ pro: "Bia", starts_at: new Date(em(dia(1), "11:00")) });
    await expect(page.locator(`[data-coluna="${await proId("Bia")}"] [data-ev][aria-label*="Rosa Arrasta"]`)).toBeVisible();
    expect(await e2eSql("select 1 from outbox where options->>'source' like 'lembrete_d1_remarcado:%'")).toHaveLength(0); // nada sai sozinho
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect.poll(async () => doHorario(id)).toMatchObject({ pro: "Maiara", starts_at: new Date(em(dia(1), "10:00")) });
  });

  test("arrastar recusa em cima de outro horário (diz quem) e não pergunta nada", async ({ page, isMobile }) => {
    test.skip(isMobile, "arrastar é do computador");
    const ida = await cliente("Ida Fica", "+5571988775002");
    const id = await horario({ contactId: ida, name: "Ida Fica", pro: "Maiara", day: dia(1), hm: "10:00" });
    const lu = await cliente("Lu Ocupa", "+5571988775003");
    await horario({ contactId: lu, name: "Lu Ocupa", pro: "Carla", day: dia(1), hm: "14:00" });
    await abrirDia(page, dia(1));
    // Soltar em cima do cartão da Lu (durante o arrastar os cartões deixam o ponteiro passar para a coluna).
    await page.dragAndDrop(`[data-ev][aria-label*="Ida Fica"]`, `[data-ev][aria-label*="Lu Ocupa"]`, { force: true });
    await expect(page.getByText("Não dá: Carla já atende Lu às 14:00.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await doHorario(id)).toMatchObject({ pro: "Maiara" });
  });

  test("Mover… no painel do horário (alternativa ao arrastar) e 'Avisar a cliente' só preenche a conversa", async ({ page }) => {
    const mel = await cliente("Mel Move", "+5571988775004", true);
    const id = await horario({ contactId: mel, name: "Mel Move", pro: "Maiara", day: dia(1), hm: "10:00" });
    await abrirDia(page, dia(1));
    const painel = page.getByRole("dialog", { name: "Mel Move" });
    await card(page, "Mel Move").click();
    await painel.getByRole("button", { name: "Mover Mel Move para outra pessoa ou hora" }).click();
    const mover = page.getByRole("dialog", { name: "Mover Mel Move" });
    await mover.getByRole("group", { name: "Para quem" }).getByRole("button", { name: /Carla/ }).click();
    await mover.getByRole("group", { name: "Hora" }).getByRole("button", { name: "13:00", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Passar Mel para a Carla às 13:00?" });
    await dlg.getByRole("switch", { name: "Avisar a cliente" }).click();
    await expect(dlg.getByText("A mensagem fica pronta na conversa; quem envia é você.")).toBeVisible();
    await dlg.getByRole("button", { name: "Passar" }).click();
    await expect(page.getByText("A mensagem para Mel ficou pronta na conversa. Nada foi enviado.")).toBeVisible();
    await expect.poll(async () => doHorario(id)).toMatchObject({ pro: "Carla", starts_at: new Date(em(dia(1), "13:00")) });
    expect(await e2eSql("select 1 from outbox o join deals d on d.id = o.deal_id where d.contact_id = $1", [mel])).toHaveLength(0);
    await page.getByRole("button", { name: "Abrir conversa" }).click();
    await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toHaveValue(/Seu horário na Casa Fiaes foi remarcado para:\n\n📅 \*.*\*\n⏰ às \*13h\*\n✨ Corte com Carla\n/);
  });

  test("fileira de fotos: clique = só ela, Shift+clique junta, Todas volta; a escolha fica na URL", async ({ page, isMobile }) => {
    test.skip(isMobile, "no celular é uma por vez (teste do celular)");
    await abrirDia(page, dia(1));
    const fotos = page.getByRole("group", { name: "Quem aparece na grade" });
    const cab = page.locator("[data-coluna-cabecalho]");
    await expect(fotos.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
    await fotos.getByRole("button", { name: "Ver só a agenda de Maiara" }).click();
    await expect(cab).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`p=${await proId("Maiara")}`));
    await fotos.getByRole("button", { name: "Ver só a agenda de Bia" }).click({ modifiers: ["Shift"] });
    await expect(cab).toHaveCount(2);
    await fotos.getByRole("button", { name: "Juntar algumas lado a lado" }).click();
    await fotos.getByRole("button", { name: "Tirar Maiara da grade" }).click();
    await expect(cab).toHaveCount(1);
    await expect(cab.first()).toContainText("Bia");
    await fotos.getByRole("button", { name: "Todas", exact: true }).click();
    await expect(page).not.toHaveURL(/p=/);
    await expect(cab.filter({ hasText: "Maiara" })).toHaveCount(1);
  });

  test("Personalizar: tamanho e serviço no cartão, 'Salvar como visão' vira aba e fica salvo para a pessoa", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const vi = await cliente("Vi Visao", "+5571988775005");
    await horario({ contactId: vi, name: "Vi Visao", pro: "Maiara", day: dia(1), hm: "10:00" });
    await abrirDia(page, dia(1));
    await page.getByRole("group", { name: "Quem aparece na grade" }).getByRole("button", { name: "Ver só a agenda de Maiara" }).click();
    await page.getByRole("button", { name: "Personalizar" }).click();
    const pz = page.getByRole("dialog", { name: "Personalizar" });
    await pz.getByRole("button", { name: "Grande" }).click();
    await pz.getByRole("switch", { name: "Telefone" }).click();
    await pz.getByLabel("Nome da visão").fill("Só a Maiara");
    await pz.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Visão Só a Maiara salva. Ela aparece nas abas em cima da grade.")).toBeVisible();
    await pz.getByRole("button", { name: "Fechar" }).click();
    await expect(card(page, "Vi Visao")).toContainText("(71) 98877-5005");
    await expect.poll(async () => ((await e2eSql("select value from user_preferences where key = 'agenda'"))[0]?.value as { ativa?: string } | undefined)?.ativa).toBe("so-a-maiara");
    // Outro dia, a mesma pessoa: a visão continua lá (salva no banco), e a Padrão volta para todas.
    await abrirDia(page, dia(2));
    const abas = page.getByRole("group", { name: "Suas visões salvas" });
    await expect(abas.getByRole("button", { name: "Só a Maiara" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-coluna-cabecalho]")).toHaveCount(1);
    await abas.getByRole("button", { name: "Padrão" }).click();
    await expect(page.locator("[data-coluna-cabecalho]").filter({ hasText: "Bia" })).toHaveCount(1);
  });

  test("Pendências: o sino conta o 'sem baixa' e o painel resolve em lote (Veio) com Desfazer", async ({ page }) => {
    const ontem = dia(-1);
    const a = await horario({ contactId: await cliente("Bela Ontem", "+5571988775006"), name: "Bela Ontem", pro: "Maiara", day: ontem, hm: "10:00", origin: "avec" });
    const b = await horario({ contactId: await cliente("Cora Ontem", "+5571988775007"), name: "Cora Ontem", pro: "Carla", day: ontem, hm: "11:00", origin: "avec" });
    await abrirDia(page, dia(0));
    await page.getByRole("button", { name: /^Pendências: \d+ sem desfecho/ }).click();
    const painel = page.getByRole("dialog", { name: "Pendências da agenda" });
    await expect(painel.getByRole("button", { name: /^Sem desfecho/, pressed: true })).toBeVisible();
    await painel.getByRole("checkbox", { name: "Selecionar Bela Ontem" }).click();
    await painel.getByRole("checkbox", { name: "Selecionar Cora Ontem" }).click();
    await painel.getByRole("button", { name: "Veio", exact: true }).click();
    await expect(page.getByText("2 baixas feitas: vieram.")).toBeVisible();
    await expect.poll(async () => [(await doHorario(a)).status, (await doHorario(b)).status]).toEqual(["compareceu", "compareceu"]);
    await expect(painel.getByText("Bela Ontem")).toHaveCount(0);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect.poll(async () => [(await doHorario(a)).status, (await doHorario(b)).status]).toEqual(["agendado", "agendado"]);
  });

  test("celular: uma profissional por vez pela fileira de fotos, cartão com nome inteiro", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const nana = await cliente("Nana Celular", "+5571988775008");
    await horario({ contactId: nana, name: "Nana Celular", pro: "Carla", day: dia(1), hm: "10:00" });
    await abrirDia(page, dia(1));
    await expect(page.locator("[data-coluna-cabecalho]:visible")).toHaveCount(1);
    await page.getByRole("group", { name: "Quem aparece na grade" }).getByRole("button", { name: "Ver só a agenda de Carla" }).click();
    await expect(page.locator("[data-coluna-cabecalho]:visible")).toContainText("Carla");
    await expect(card(page, "Nana Celular")).toContainText("Nana Celular");
    const largura = await page.locator("[data-coluna-cabecalho]:visible").evaluate((el) => el.getBoundingClientRect().width);
    expect(largura).toBeGreaterThan(page.viewportSize()!.width * 0.6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // nada de rolar para o lado
  });
});
