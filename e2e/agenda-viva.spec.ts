import { expect, test, type Page } from "@playwright/test";
import { e2eSql, isola, login, simulate } from "./helpers";

/**
 * Lote 6B (agenda viva), nos projetos desktop e celular. O reset deixa o modo dupla, a Maiara e a Carla (9h–18h todo dia), a Bia (segue a
 * Casa: 24 h no e2e), Corte (60 min) e Hidratação (45 min) feitos pelas três. Cada teste limpa os horários do CRM e cria as próprias clientes.
 */
const OFFSET_MS = 3 * 3_600_000; // Salvador
const dia = (n: number) => new Date(Date.now() - OFFSET_MS + n * 86_400_000).toISOString().slice(0, 10);
const hojeHM = () => new Date(Date.now() - OFFSET_MS).toISOString().slice(11, 16);
/** Instante de "dia AAAA-MM-DD às HH:MM em Salvador". */
const em = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).toISOString();
const proId = async (name: string) => String((await e2eSql("select id from professionals where name = $1", [name]))[0].id);
const serviceId = async (label: string) => String((await e2eSql("select id from lists where kind = 'service' and label = $1", [label]))[0].id);
async function cliente(name: string, phone: string) {
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [name, phone]);
  return String(c.id);
}
/** Um horário do CRM direto no banco (para testar o que vem depois de marcar). */
async function horario(o: { contactId: string; name: string; pro: string; day: string; hm: string; status?: string }) {
  const [a] = await e2eSql(
    `insert into appointments (contact_id, client_name, professional_id, service_id, service_label, starts_at, duration_min, status, origin, external_key)
     values ($1, $2, $3, $4, 'Corte', $5, 60, $6, 'crm', 'e2e:' || gen_random_uuid()) returning id`,
    [o.contactId, o.name, await proId(o.pro), await serviceId("Corte"), em(o.day, o.hm), o.status ?? "agendado"]);
  return String(a.id);
}
const doCliente = (contactId: string) => e2eSql("select a.*, p.name as pro from appointments a left join professionals p on p.id = a.professional_id where a.contact_id = $1 order by a.starts_at", [contactId]);
const marcar = (page: Page) => page.getByRole("dialog", { name: "Marcar horário" });

test.describe("Lote 6B: agenda viva", () => {
  test.beforeEach(async ({ page }) => {
    // Lote 7A: avisos e anotações da profissional apontam para os horários.
    await e2eSql("delete from pro_notifications");
    await e2eSql("delete from client_notes");
    await e2eSql("delete from client_links");
    await e2eSql("delete from appointments where origin = 'crm'");
    await e2eSql("delete from form_answers"); // QA r66 M-5: a FK de form_answers.visit_id
    await e2eSql("delete from visits");
    await e2eSql("delete from agenda_blocks");
    await login(page);
  });

  test("desktop: tocar no livre da Maiara abre o Marcar já com ela e a hora; marca e aparece na grade", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const paula = await cliente("Paula Viva", "+5571988771001");
    await page.goto(`/agenda?d=${dia(1)}`);
    await page.getByRole("button", { name: "Marcar com Maiara às 10:00" }).click();
    const dlg = marcar(page);
    await dlg.getByLabel("Buscar cliente por nome ou telefone").fill("Paula Viv");
    await dlg.getByRole("button", { name: /Paula Viva/ }).click();
    await dlg.getByLabel("Serviço 1").selectOption({ label: "Corte" });
    await expect(dlg.getByTestId("booking-preview")).toHaveText("Livre");
    await expect(dlg.getByText("Enquanto o Avec estiver ligado, marque, remarque e cancele também lá.")).toBeVisible();
    await dlg.getByRole("radio", { name: "Ela quer a Maiara" }).click();
    await dlg.getByRole("button", { name: "Marcar", exact: true }).click();
    await expect(page.getByText(/Horário marcado: Paula/)).toBeVisible();
    const [a] = await doCliente(paula);
    expect(a).toMatchObject({ origin: "crm", status: "agendado", pro: "Maiara", fit_in: false, preference: "escolhida" });
    expect(new Date(String(a.starts_at)).toISOString()).toBe(em(dia(1), "10:00"));
    const card = page.getByRole("button", { name: /10:00 – 11:00, Paula Viva, Corte/ });
    await expect(card).toBeVisible();
    // Nova Agenda (16/10): o cartão fica limpo (hora, nome, faixa do status); o selo da preferência (6.11) está no painel do horário.
    await card.click();
    await expect(page.getByRole("dialog", { name: "Paula Viva" }).locator('[data-preferencia="escolhida"]')).toHaveText(/Pediu ela/);
  });

  test("desktop: conflito mostra quem está no horário; 'Encaixar mesmo assim' grava o encaixe com quem fez", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const paula = await cliente("Paula Viva", "+5571988771001");
    await horario({ contactId: paula, name: "Paula Viva", pro: "Maiara", day: dia(1), hm: "10:00" });
    const rita = await cliente("Rita Conflito", "+5571988771002");
    await page.goto(`/agenda?d=${dia(1)}`);
    await page.getByRole("button", { name: "Marcar horário" }).click();
    const dlg = marcar(page);
    await dlg.getByLabel("Buscar cliente por nome ou telefone").fill("Rita Con");
    await dlg.getByRole("button", { name: /Rita Conflito/ }).click();
    await dlg.getByLabel("Serviço 1").selectOption({ label: "Corte" });
    await dlg.getByLabel("Profissional 1").selectOption({ label: "Maiara" });
    await dlg.getByLabel("Dia").fill(dia(1));
    await dlg.getByLabel("Hora").fill("10:30");
    await expect(dlg.getByTestId("booking-preview")).toHaveText("Maiara já tem Paula das 10:00 às 11:00");
    await dlg.getByRole("radio", { name: "Ela quer a Maiara" }).click();
    await expect(dlg.getByRole("button", { name: "Escolher outro horário" })).toBeVisible();
    await dlg.getByRole("button", { name: "Encaixar mesmo assim" }).click(); // secundário: abre o motivo
    await dlg.getByLabel("Por que vai encaixar por cima de outra cliente?").fill("Cliente antiga pediu urgência");
    await dlg.getByRole("button", { name: "Encaixar mesmo assim" }).click();
    await expect(page.getByText(/Horário marcado: Rita/)).toBeVisible();
    const [a] = await doCliente(rita);
    expect(a).toMatchObject({ fit_in: true, pro: "Maiara" });
    expect(a.fit_in_by).toBe((await e2eSql("select id from users where email = 'gestao@e2e.local'"))[0].id);
  });

  test("Chegou num horário marca a visita inteira (17/10)", async ({ page }) => {
    const hoje = dia(0);
    const vera = await cliente("Vera Visita", "+5571988771011");
    await horario({ contactId: vera, name: "Vera Visita", pro: "Bia", day: hoje, hm: hojeHM() });
    await horario({ contactId: vera, name: "Vera Visita", pro: "Carla", day: hoje, hm: hojeHM(), status: "confirmado" });
    await page.goto("/agenda?v=lista");
    const sheet = page.getByRole("dialog", { name: "Vera Visita" });
    await expect(async () => {
      if (!(await sheet.isVisible())) await page.getByTestId("agenda-item").filter({ hasText: "Vera Visita" }).first().locator('button[aria-haspopup="dialog"]').click();
      await expect(sheet).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await sheet.getByRole("button", { name: "Chegou", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "e mais 1 serviço da visita" })).toBeVisible();
    await expect.poll(async () => (await doCliente(vera)).map((a) => a.status)).toEqual(["chegou", "chegou"]);
  });

  test("o horário aberto mostra a visita inteira: as profissionais, o estado de cada serviço e Começar por serviço (17/10)", async ({ page }) => {
    const hoje = dia(0);
    const nina = await cliente("Nina Visita", "+5571988771012");
    await horario({ contactId: nina, name: "Nina Visita", pro: "Bia", day: hoje, hm: hojeHM() });
    await horario({ contactId: nina, name: "Nina Visita", pro: "Carla", day: hoje, hm: hojeHM(), status: "chegou" });
    await horario({ contactId: nina, name: "Nina Visita", pro: "Maiara", day: hoje, hm: hojeHM() });
    await page.goto("/agenda?v=lista");
    const sheet = page.getByRole("dialog", { name: "Nina Visita" });
    await expect(async () => {
      if (!(await sheet.isVisible())) await page.getByTestId("agenda-item").filter({ hasText: "Nina Visita" }).first().locator('button[aria-haspopup="dialog"]').click();
      await expect(sheet).toBeVisible({ timeout: 2_000 });
    }).toPass();
    const visita = sheet.getByRole("region", { name: "Visita de Nina Visita" });
    await expect(visita.getByTestId("visita-servico")).toHaveCount(3);
    for (const pro of ["Bia", "Carla", "Maiara"]) await expect(visita).toContainText(pro);
    await visita.getByRole("button", { name: "Começar" }).click();
    await expect.poll(async () => (await doCliente(nina)).map((a) => a.status).sort()).toEqual(["agendado", "agendado", "em_atendimento"]);
  });

  test("Chegou → Iniciar → Finalizar pela Lista, e cancelar pede o motivo", async ({ page }) => {
    const hoje = dia(0);
    const lia = await cliente("Lia Atende", "+5571988771003");
    await horario({ contactId: lia, name: "Lia Atende", pro: "Bia", day: hoje, hm: hojeHM() });
    const tina = await cliente("Tina Cancela", "+5571988771004");
    await horario({ contactId: tina, name: "Tina Cancela", pro: "Carla", day: dia(2), hm: "15:00" });
    await page.goto("/agenda?v=lista");
    const abrir = async (nome: string) => {
      const sheet = page.getByRole("dialog", { name: nome });
      if (!(await sheet.isVisible())) await page.getByTestId("agenda-item").filter({ hasText: nome }).locator('button[aria-haspopup="dialog"]').click();
      return sheet;
    };
    for (const [passo, status] of [["Chegou", "chegou"], ["Iniciar", "em_atendimento"], ["Finalizar", "compareceu"]] as const) {
      await (await abrir("Lia Atende")).getByRole("button", { name: passo, exact: true }).click();
      await expect.poll(async () => (await doCliente(lia))[0].status).toBe(status);
    }
    await page.goto(`/agenda?v=lista&d=${dia(2)}`);
    await (await abrir("Tina Cancela")).getByRole("button", { name: "Cancelar horário" }).click();
    const cancel = page.getByRole("dialog", { name: "Cancelar horário" });
    await cancel.getByRole("radio", { name: "A cliente desmarcou" }).click();
    await cancel.getByRole("button", { name: "Cancelar horário" }).click();
    await expect.poll(async () => (await doCliente(tina))[0]).toMatchObject({ status: "cancelado", cancel_reason: "cliente_desmarcou" });
  });

  test("lista de espera: põe a cliente e depois Encaixar marca pela mesma porta", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    const nina = await cliente("Nina Espera", "+5571988771005");
    await page.goto("/agenda?aba=espera");
    await page.getByRole("button", { name: "+ Lista de espera" }).click();
    const dlg = page.getByRole("dialog", { name: "Lista de espera" });
    await dlg.getByLabel("Buscar cliente por nome ou telefone").fill("Nina Esp");
    await dlg.getByRole("button", { name: /Nina Espera/ }).click();
    await dlg.getByLabel("Serviço desejado").selectOption({ label: "Hidratação" });
    await dlg.getByLabel("Dia desejado").fill(dia(1));
    await dlg.getByRole("radio", { name: "Tarde" }).click();
    await dlg.getByRole("button", { name: "Pôr na lista de espera" }).click();
    await expect.poll(async () => (await doCliente(nina)).map((a) => a.status)).toEqual(["espera"]);
    await page.getByRole("button", { name: "Encaixar" }).first().click();
    const enc = page.getByRole("dialog", { name: "Encaixar da lista de espera" });
    await enc.getByLabel("Profissional 1").selectOption({ label: "Carla" });
    await enc.getByLabel("Hora").fill("14:00");
    await enc.getByRole("radio", { name: "Ela quer a Carla" }).click();
    await enc.getByRole("button", { name: "Marcar", exact: true }).click();
    // O horário nasce pela porta de marcar; o pedido fica no banco como "espera_encaixada", apontando para ele (6B.8).
    await expect.poll(async () => (await doCliente(nina)).map((a) => [a.status, a.pro]).sort()).toEqual([["agendado", "Carla"], ["espera_encaixada", null]]);
    const rows = await doCliente(nina);
    expect(rows.find((a) => a.status === "espera_encaixada")?.wait_result_appointment_id).toBe(rows.find((a) => a.status === "agendado")?.id);
  });

  test("fileira de fotos: folga fica apagada e não vira coluna; tocar mostra só ela; Semana é a contagem por dia", async ({ page, isMobile }) => {
    test.skip(isMobile, "no celular é uma por vez: coberto no teste do celular");
    await e2eSql("update professionals set work_hours = jsonb_set(work_hours, $1, 'null') where name = 'Carla'", [`{${new Date(`${dia(1)}T12:00:00Z`).getUTCDay()}}`]);
    try {
      await page.goto(`/agenda?d=${dia(1)}`);
      const fotos = page.getByRole("group", { name: "Quem aparece na grade" });
      await expect(fotos.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(fotos.getByRole("button", { name: "Ver só a agenda de Carla" })).toHaveAttribute("title", /Carla · folga/);
      const cabecalhos = page.locator("[data-coluna-cabecalho]");
      await expect(cabecalhos.filter({ hasText: "Maiara" })).toHaveCount(1);
      await expect(cabecalhos.filter({ hasText: "Bia" })).toHaveCount(1);
      await expect(cabecalhos.filter({ hasText: "Carla" })).toHaveCount(0); // de folga: não vira coluna
      await fotos.getByRole("button", { name: "Ver só a agenda de Carla" }).click(); // tocar mostra mesmo assim
      await expect(cabecalhos).toHaveCount(1);
      await expect(cabecalhos.first()).toContainText("folga neste dia");
      await page.getByRole("navigation", { name: "Ver por" }).getByRole("link", { name: "Semana" }).click(); // o menu lateral também tem Agenda › Semana
      await expect(page.getByRole("table")).toBeVisible(); // a contagem por dia e por profissional (WeekByPro, 6B.14)
    } finally {
      await e2eSql(`update professionals set work_hours = (select jsonb_object_agg(d::text, '[["09:00","18:00"]]'::jsonb) from generate_series(0, 6) d) where name = 'Carla'`);
    }
  });

  test("foto: enviar no cadastro e ver na fileira de fotos da Agenda", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop");
    // PNG 1×1 válido (o servidor confere o conteúdo, não o nome)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await page.goto(`/config/profissionais?id=${await proId("Carla")}`);
    await page.getByRole("region", { name: "Ficha de Carla" }).getByLabel("Enviar foto").setInputFiles({ name: "carla.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Foto salva")).toBeVisible();
    expect((await e2eSql("select photo_path from professionals where name = 'Carla'"))[0].photo_path).toMatch(/^profissionais\/.+\/\d+\.png$/);
    await page.goto(`/agenda?d=${dia(1)}`);
    const img = page.getByRole("group", { name: "Quem aparece na grade" }).getByRole("button", { name: "Ver só a agenda de Carla" }).locator("img");
    await expect(img).toHaveAttribute("src", /\/api\/profissionais\/.+\/foto\?v=\d+/);
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("celular: Marcar horário com busca de cliente; a faixa de fotos no topo e uma profissional por vez", async ({ page, isMobile }) => {
    test.skip(!isMobile, "celular");
    const vera = await cliente("Vera Celular", "+5571988771006");
    await page.goto(`/agenda?d=${dia(1)}`);
    const faixa = page.getByRole("group", { name: "Quem aparece na grade" });
    await expect(faixa.getByRole("button", { name: /Maiara$/ })).toBeVisible(); // "MAIARA E2E" (ficha.spec) também é profissional
    const largura = await page.locator("[data-coluna-cabecalho]").first().evaluate((el) => el.getBoundingClientRect().width);
    expect(largura).toBeGreaterThan(page.viewportSize()!.width * 0.6); // uma coluna ocupa a tela
    await page.getByRole("button", { name: "Marcar horário" }).click();
    const dlg = marcar(page);
    await dlg.getByLabel("Buscar cliente por nome ou telefone").fill("Vera Cel");
    await dlg.getByRole("button", { name: /Vera Celular/ }).click();
    await dlg.getByLabel("Serviço 1").selectOption({ label: "Corte" });
    await dlg.getByLabel("Profissional 1").selectOption({ label: "Maiara" });
    await dlg.getByLabel("Dia").fill(dia(1));
    await dlg.getByLabel("Hora").fill("11:00");
    await expect(dlg.getByTestId("booking-preview")).toHaveText("Livre");
    await dlg.getByRole("radio", { name: "Ela quer a Maiara" }).click();
    await dlg.getByRole("button", { name: "Marcar", exact: true }).click();
    await expect.poll(async () => (await doCliente(vera)).map((a) => a.pro)).toEqual(["Maiara"]);
  });

  test("conversa: 'Agendar' abre o Marcar horário (modo dupla), 'Tanto faz' escolhe a livre e o lead vai para Agendado", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop (o painel do cliente no celular é coberto pelo cliente.spec)");
    await isola("+5571988772");
    await simulate(page, { phone: "71 98877-2001", name: "Olga Conversa", text: "Oi, queria marcar um corte" });
    const [d] = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = '+5571988772001' order by d.created_at desc limit 1");
    await page.goto(`/atendimento?lead=${d.id}`);
    await page.getByRole("region", { name: "Dados do cliente" }).getByRole("button", { name: /^Agendar horário/ }).click();
    const dlg = marcar(page);
    await expect(dlg.getByRole("region", { name: "Cliente" })).toContainText("Olga Conversa");
    await dlg.getByLabel("Serviço 1").selectOption({ label: "Corte" });
    await dlg.getByLabel("Dia").fill(dia(1));
    await dlg.getByLabel("Hora").fill("16:00");
    await expect(dlg.getByTestId("booking-preview")).toHaveText(/^Livre com a /); // "Tanto faz": o sistema sugere a primeira livre
    await dlg.getByRole("radio", { name: "Tanto faz quem atende" }).click();
    await dlg.getByRole("button", { name: "Marcar", exact: true }).click();
    await expect.poll(async () => (await e2eSql("select s.key from deals d join stages s on s.id = d.stage_id where d.id = $1", [d.id]))[0].key).toBe("agendado");
    const [a] = await e2eSql("select deal_id, origin, preference, any_pro from appointments where contact_id = (select contact_id from deals where id = $1)", [d.id]);
    expect(a).toMatchObject({ deal_id: d.id, origin: "crm", preference: "sem_preferencia", any_pro: true });
  });
});
