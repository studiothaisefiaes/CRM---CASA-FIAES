import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, isola, shot } from "./helpers";

const leadId = async (phoneE164: string) =>
  String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [phoneE164]))[0].id);

test("Lote 5: nota interna com @, status Aguardando e mensagem programada pelo relógio (e cancelada), sem enviar nada", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997505");
  await simulate(page, { phone: "71 99750-5001", name: "Cliente Lote Cinco", text: "Vou ver com meu marido e te falo" });
  const id = await leadId("+5571997505001");
  await page.goto(`/atendimento?lead=${id}`);
  const lead = page.getByRole("region", { name: /Conversa com Cliente Lote Cinco/ });
  await expect(lead).toBeVisible();

  // Nota interna chamando a Ana (atendente do e2e): a nota aparece e ela recebe o aviso.
  await page.getByRole("button", { name: "Nota para a equipe (a cliente não vê)" }).click();
  await page.getByLabel("Nota interna", { exact: true }).fill("Confere o preço @An");
  await page.getByRole("button", { name: /@Ana/ }).click();
  await page.getByRole("button", { name: "Salvar nota" }).click();
  await expect(page.getByRole("note", { name: "Nota interna" })).toContainText("Confere o preço @Ana");
  await expect.poll(async () => Number((await e2eSql("select count(*)::int as n from alerts where type = 'mencao' and deal_id = $1", [id]))[0].n)).toBe(1); // só desta conversa: o "Passar para" com nota também gera menção

  // Status Aguardando (antes "Resolvido, não precisa responder"): sai do prazo sem mandar nada.
  await page.getByRole("button", { name: /^Status: Aberto/ }).click();
  await page.getByRole("menuitem", { name: /^Aguardando/ }).click();
  await expect.poll(async () => (await e2eSql("select awaiting_reply_since is null as livre, resolved_at is not null as resolvida from deals where id = $1", [id]))[0]).toEqual({ livre: true, resolvida: true });
  await expect(lead.getByTestId("status-conversa")).toHaveText(/Aguardando/);

  // Programar mensagem (o relógio do campo): abre o Retomar com o texto; aparece acima do campo e some ao cancelar (a Evolution do e2e é a morta; nada sai).
  await page.getByRole("button", { name: "Voltar para mensagem" }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill("Oi! Conseguiu falar com ele?");
  await page.getByRole("button", { name: "Programar mensagem" }).click();
  const dlg = page.getByRole("dialog", { name: /^Retomar/ });
  await expect(dlg.getByLabel("Mensagem (opcional)")).toHaveValue("Oi! Conseguiu falar com ele?");
  await dlg.getByRole("radio", { name: "Amanhã 10:00" }).click();
  await dlg.getByRole("button", { name: "Programar" }).click();
  await expect(page.getByLabel("Mensagem", { exact: true })).toHaveValue(""); // o texto foi para a mensagem programada
  const strip = page.getByRole("group", { name: "Mensagem programada" });
  await expect(strip).toContainText("Retomada · amanhã 10:00 · sai sozinha");
  await shot(page, "lote5-nota-programada");
  await strip.getByRole("button", { name: "Cancelar a mensagem programada" }).click();
  await expect(strip).toHaveCount(0);
  expect(Number((await e2eSql("select count(*)::int as n from outbox where deal_id = $1 and status = 'pending'", [id]))[0].n)).toBe(0);
  expect(Number((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [id]))[0].n)).toBe(0);
});

test("Lote 5: ligação atendida na conversa, anotar o que foi falado, Marcar horário e a prévia na Fila", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997506");
  await simulate(page, { phone: "71 99750-6001", name: "Cliente Ligação Teste", text: "Oi, vou ligar" });
  const id = await leadId("+5571997506001");
  // A ligação chega pelo webhook (testado no vitest); aqui ela já está gravada como o webhook grava.
  await e2eSql(`insert into messages (deal_id, contact_id, direction, kind, body, status, external_id, call, created_at)
    select d.id, d.contact_id, 'in', 'call', 'Ligação recebida · atendida · 3 min', 'received', 'call:e2e-1', '{"video":false,"status":"atendida","durationSecs":185}'::jsonb, now()
    from deals d where d.id = $1`, [id]);
  await e2eSql("update messages set reactions = '{\"cliente\":\"❤️\"}'::jsonb where deal_id = $1 and kind = 'text'", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  await expect(page.getByTestId("ligacao")).toContainText("Ligação recebida · atendida · 3 min");
  await expect(page.getByLabel("Reação da cliente: ❤️")).toBeVisible();

  await page.getByRole("button", { name: "Anotar o que foi falado" }).click();
  await page.getByLabel("Assunto").fill("Agendamento");
  await page.getByLabel("O que ocorreu").fill("marcou corte sábado 14h com a Ana");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  const card = page.getByTestId("ligacao-card");
  await expect(card).toContainText("marcou corte sábado 14h com a Ana");
  await expect(card).toContainText("Agendamento");
  await shot(page, "lote5-ligacao-anotada");
  // A anotação é nota interna ligada à ligação, com autora.
  const [n] = await e2eSql("select n.subject, n.body, n.author_id is not null as autora from contact_notes n join messages m on m.id = n.message_id where m.external_id = 'call:e2e-1'");
  expect(n).toEqual({ subject: "Agendamento", body: "marcou corte sábado 14h com a Ana", autora: true });
  // Atalho: Marcar horário abre a folha de agendar da conversa (6B: fora do modo consulta, o "Marcar horário" da Agenda).
  await card.getByRole("button", { name: "Marcar horário" }).click();
  await expect(page.getByRole("dialog", { name: /Agendar|Marcar horário/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Prévia na Fila: "Ligação 3 min · Agendamento".
  await page.goto("/atendimento");
  await expect(page.getByText("Ligação 3 min · Agendamento").first()).toBeVisible();
  expect(Number((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [id]))[0].n)).toBe(0);
});

test("Lote 5: respostas prontas — variável sem dado vira campo e bloqueia o envio", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997507");
  await simulate(page, { phone: "71 99750-7001", name: "Cliente Respostas Teste", text: "Oi, quero confirmar" });
  const id = await leadId("+5571997507001");
  await page.goto(`/atendimento?lead=${id}`);
  const msg = page.getByLabel("Mensagem", { exact: true });
  await msg.fill("/confirmar");
  const list = page.getByRole("listbox", { name: "Respostas prontas" });
  await expect(list).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova resposta pronta" })).toBeVisible();
  await list.getByRole("option").first().getByRole("button").first().click();
  const falta = page.getByRole("group", { name: "Falta preencher" });
  await expect(falta).toBeVisible();
  await expect(msg).not.toHaveValue(/\{primeiro_nome\}/);
  // Enviar com a variável pendente: bloqueado com o aviso, nada sai (o texto cru nunca chega à cliente).
  await page.waitForTimeout(600); // o campo não envia logo depois de preencher (tempo de revisar)
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/Falta preencher: .*Preencha acima do campo antes de enviar\./).first()).toBeVisible();
  expect(Number((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [id]))[0].n)).toBe(0);
  await shot(page, "lote5-resposta-falta");
});

test("Lote 5: mensagem em massa e menu de boas-vindas nascem desligados; Importar do ChatGuru mostra a tela", async ({ page }) => {
  await login(page);
  await page.goto("/config/massa");
  await expect(page.getByRole("switch", { name: "Ligar mensagem em massa" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Nenhuma mensagem em massa ainda.")).toBeVisible();
  await shot(page, "lote5-massa-desligada");
  await page.goto("/contatos");
  await expect(page.getByRole("button", { name: "Mensagem em massa" })).toHaveCount(0);
  await page.goto("/config/menu");
  await expect(page.getByRole("switch", { name: "Ligar o menu" })).toHaveAttribute("aria-checked", "false");
  await page.goto("/config/chatguru");
  await expect(page.getByRole("heading", { name: "Importar do ChatGuru" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver prévia" })).toBeDisabled();
  await shot(page, "lote5-chatguru");
  expect(await e2eSql("select key from settings where key in ('envio_massa', 'menu_boas_vindas')")).toEqual([]);
});
