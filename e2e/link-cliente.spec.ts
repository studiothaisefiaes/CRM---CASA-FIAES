import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { e2eSql, login } from "./helpers";

/** O domínio dos links da cliente no e2e (CLIENT_LINK_URL do playwright.config): o mesmo servidor por 127.0.0.1. */
const CLIENT_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

const PREFIXO = "+557199666";
const HOUR = 3_600_000;
const bahiaDay = (ms: number) => new Date(ms - 3 * HOUR).toISOString().slice(0, 10);
/** Daqui a N dias, na hora dada de Salvador. */
const daysAhead = (n: number, hm: string) => new Date(`${bahiaDay(Date.now() + n * 24 * HOUR)}T${hm}:00-03:00`);

/** Visita com um horário e um link (o token sai daqui; no banco vai só o hash, como no servidor). */
async function visitWithLink(o: { name: string; phone: string; startsAt: Date }) {
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [o.name, o.phone]);
  const [pro] = await e2eSql("select id from professionals where lower(name) = 'maiara'");
  const day = bahiaDay(o.startsAt.getTime());
  const [v] = await e2eSql("insert into visits (contact_id, client_name, day, origin) values ($1, $2, $3::date, 'crm') returning id", [c.id, o.name, day]);
  const [a] = await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key, visit_id)
    values ($1, $2, $3, 'Corte E2E', $4, 60, 'agendado', 'crm', 'e2e:link:' || gen_random_uuid(), $5) returning id`, [c.id, o.name, pro.id, o.startsAt.toISOString(), v.id]);
  const token = randomBytes(32).toString("base64url");
  await e2eSql("insert into client_links (token_hash, visit_id, issued_starts_at, created_via, expires_at) values ($1, $2, $3, 'agenda', $4)",
    [createHash("sha256").update(token).digest("hex"), v.id, o.startsAt.toISOString(), new Date(o.startsAt.getTime() + 25 * HOUR).toISOString()]);
  return { token, appointmentId: String(a.id), contactId: String(c.id), day };
}

test.beforeAll(async () => {
  await e2eSql(`insert into settings (key, value) values ('agenda_modo', '"dupla"'::jsonb) on conflict (key) do update set value = excluded.value`);
  await e2eSql(`insert into settings (key, value) values ('casa_info', '{"endereco":"Rua das Flores, 10 - Pituba","whatsapp":"+5571988887777"}'::jsonb) on conflict (key) do update set value = excluded.value`);
});

// Os horários do spec saem da agenda no fim (não mudam as sugestões dos specs da Agenda).
test.afterAll(async () => { await e2eSql("update appointments set status = 'cancelado' where external_key like 'e2e:link:%'"); });

test.describe("link da cliente (celular, sem login)", () => {
  test.skip(({ isMobile }) => !isMobile, "a cliente abre no celular");

  test("abre sem login, confirma, e a Agenda no computador mostra 'Confirmou pelo link'", async ({ page, browser }) => {
    const v = await visitWithLink({ name: "Clara Link", phone: `${PREFIXO}0001`, startsAt: daysAhead(3, "10:00") });
    await page.goto(`/c/${v.token}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oi, Clara! Seu horário na Casa Fiaes");
    await expect(page.getByText("Clara Link")).toHaveCount(0); // sobrenome nunca aparece
    await expect(page.getByRole("link", { name: "Como chegar" })).toBeVisible();
    await page.getByRole("button", { name: "Confirmar presença" }).click();
    await expect(page.getByText("Pronto! Seu horário está confirmado. Te esperamos!")).toBeVisible();
    expect((await e2eSql("select status, confirmed_via from appointments where id = $1", [v.appointmentId]))[0]).toMatchObject({ status: "confirmado", confirmed_via: "link" });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Bahia" });
    const gestao = await ctx.newPage();
    try {
      await login(gestao);
      await gestao.goto(`/agenda?d=${v.day}`);
      await gestao.getByText("Clara Link").first().click();
      const card = gestao.getByRole("dialog");
      await expect(card).toContainText("Confirmado");
      await expect(card.getByText(/^Confirmou pelo link/)).toBeVisible();
    } finally { await ctx.close(); }
  });

  test("cancela com motivo", async ({ page }) => {
    const v = await visitWithLink({ name: "Duda Link", phone: `${PREFIXO}0002`, startsAt: daysAhead(3, "15:00") });
    await page.goto(`/c/${v.token}`);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByLabel("Imprevisto").check();
    await page.getByRole("button", { name: "Cancelar horário" }).click();
    await expect(page.getByText(/^Pronto, seu horário foi cancelado/)).toBeVisible();
    await expect(page.getByText("Este horário foi cancelado.")).toBeVisible();
    expect((await e2eSql("select status, cancelled_via, cancel_reason from appointments where id = $1", [v.appointmentId]))[0])
      .toMatchObject({ status: "cancelado", cancelled_via: "link", cancel_reason: "cliente_desmarcou" });
  });

  test("a menos de 24 h: 'Falar com a Casa' no lugar de Cancelar", async ({ page }) => {
    const v = await visitWithLink({ name: "Eva Link", phone: `${PREFIXO}0003`, startsAt: new Date(Date.now() + 3 * HOUR) });
    await page.goto(`/c/${v.token}`);
    await expect(page.getByRole("link", { name: "Falar com a Casa" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirmar presença" })).toBeVisible();
  });

  test("link errado: página genérica; cabeçalhos sem cache, sem indexar e sem Referer; .ics; axe", async ({ page, request }) => {
    await page.goto(`/c/${"x".repeat(43)}`);
    await expect(page.getByText("Este link não vale mais. Fale com a Casa pelo WhatsApp.")).toBeVisible();
    const v = await visitWithLink({ name: "Gabi Link", phone: `${PREFIXO}0004`, startsAt: daysAhead(4, "11:00") });
    const r = await request.get(`/c/${v.token}`);
    expect(r.headers()["referrer-policy"]).toBe("no-referrer");
    expect(r.headers()["x-robots-tag"]).toContain("noindex");
    expect(r.headers()["cache-control"]).toContain("no-store");
    const ics = await request.get(`/c/${v.token}/agenda.ics`);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const body = await ics.text();
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).not.toContain("Gabi");
    await page.goto(`/c/${v.token}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? "")).map((x) => x.id)).toEqual([]);
  });
});

test.describe("lado da equipe (computador)", () => {
  test.skip(({ isMobile }) => isMobile, "desktop");

  test("'Enviar link de confirmação' só preenche a caixa de mensagem: nada é enviado", async ({ page }) => {
    const v = await visitWithLink({ name: "Fabi Link", phone: `${PREFIXO}0005`, startsAt: daysAhead(2, "11:00") });
    const [st] = await e2eSql("select id from stages where kind = 'agendado' limit 1");
    const [d] = await e2eSql("insert into deals (contact_id, stage_id, scheduled_at, stage_entered_at) values ($1, $2, $3, now()) returning id", [v.contactId, st.id, daysAhead(2, "11:00").toISOString()]);
    await e2eSql("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at) values ($1, $2, 'in', 'text', 'Oi, tudo bem?', 'received', now())", [d.id, v.contactId]);
    await login(page);
    await page.goto(`/atendimento?lead=${d.id}`);
    await page.getByRole("button", { name: "Enviar link de confirmação" }).click();
    // Link curto no domínio da cliente (CLIENT_LINK_URL = 127.0.0.1 no e2e): 8 símbolos sem 0/O/1/l/I.
    await expect(page.getByLabel("Mensagem", { exact: true })).toHaveValue(new RegExp(`^Olá, Fabi! 💛\\n\\nSeu horário na Casa Fiaes:\\n[^]+ é só tocar aqui: ${CLIENT_URL.replace(/[.]/g, "\\.")}/c/[2-9A-HJ-NP-Za-km-z]{8}$`));
    await page.waitForTimeout(1500);
    expect((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [d.id]))[0].n).toBe(0);
    expect((await e2eSql("select count(*)::int as n from outbox where deal_id = $1", [d.id]))[0].n).toBe(0);
  });

  test("agendamento online desligado: /agendar dá 404 com a página em português", async ({ request }) => {
    const r = await request.get("/agendar");
    expect(r.status()).toBe(404);
    expect(await r.text()).toContain("Agendamento online indispon");
  });

  test("pedido do site: o aviso do Hoje abre direto os Pedidos do site; Recusar pede confirmação e motivo (QA r58, I-6)", async ({ page }) => {
    const [c] = await e2eSql("insert into contacts (name, phone_e164) values ('Olivia Site', '+5571996660090') on conflict (phone_e164) do update set name = excluded.name returning id");
    const [pro] = await e2eSql("select id from professionals where lower(name) = 'maiara'");
    const startsAt = daysAhead(5, "10:00");
    const [v] = await e2eSql("insert into visits (contact_id, client_name, day, origin) values ($1, 'Olivia Site', $2::date, 'online') returning id", [c.id, bahiaDay(startsAt.getTime())]);
    await e2eSql(`insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key, visit_id)
      values ($1, 'Olivia Site', $2, 'Corte E2E', $3, 60, 'solicitado', 'crm', 'e2e:link:' || gen_random_uuid(), $4)`, [c.id, pro.id, startsAt.toISOString(), v.id]);
    const [me] = await e2eSql("select id from users where email = 'gestao@e2e.local'");
    await e2eSql(`insert into alerts (user_id, audience, type, severity, message, dedupe_key) values ($1, 'responsavel', 'pedido_online', 'info',
      'Olivia pediu Corte E2E pelo site. Confirme ou recuse na Agenda.', $2) on conflict do nothing`, [me.id, `online:${v.id}:${me.id}`]);
    await login(page);
    await page.goto("/?vista=resumo");
    const avisos = page.getByRole("region", { name: "Avisos para você" });
    await avisos.getByRole("link", { name: /Olivia pediu Corte E2E/ }).click();
    await expect(page).toHaveURL(/\/agenda\?pedidos=site/);
    const sheet = page.getByRole("dialog", { name: "Pedidos do site" });
    await expect(sheet.getByText("Olivia Site · Corte E2E")).toBeVisible();
    await sheet.getByRole("button", { name: "Recusar" }).click();
    const confirmar = page.getByRole("dialog", { name: "Recusar o pedido?" });
    await confirmar.getByRole("button", { name: "Recusar pedido" }).click();
    await expect(confirmar.getByText("Escreva o motivo da recusa.")).toBeVisible();
    expect((await e2eSql("select status from appointments where visit_id = $1", [v.id]))[0].status).toBe("solicitado");
    await confirmar.getByLabel("Motivo").fill("Maiara de folga nesse dia");
    await confirmar.getByRole("button", { name: "Recusar pedido" }).click();
    await expect(page.getByText("Recusado. Avise a cliente no WhatsApp.")).toBeVisible();
    expect((await e2eSql("select status, cancel_reason, cancel_note from appointments where visit_id = $1", [v.id]))[0]).toMatchObject({ status: "cancelado", cancel_reason: "recusado", cancel_note: "Maiara de folga nesse dia" });
  });

  test("Configurações: o link completo do agendamento online com Copiar; ligar sem serviço é bloqueado (QA r58, I-5)", async ({ page, context }) => {
    await e2eSql("delete from settings where key = 'agendamento_online'");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page);
    await page.goto("/config/agendamento-online");
    await expect(page.getByLabel("Link do agendamento online")).toHaveValue(`${CLIENT_URL}/agendar`);
    await page.getByRole("button", { name: "Copiar link" }).click();
    await expect(page.getByRole("button", { name: "Link copiado" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${CLIENT_URL}/agendar`);
    await page.getByRole("switch", { name: "Agendamento online" }).click();
    await expect(page.getByText("Escolha ao menos um serviço.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Agendamento online" })).toHaveAttribute("aria-checked", "false");
    expect(await e2eSql("select value from settings where key = 'agendamento_online'")).toHaveLength(0);
  });
});

test.describe("domínio dos links da cliente (CLIENT_LINK_URL)", () => {
  test.skip(({ isMobile }) => !isMobile, "a cliente abre no celular");

  test("nesse host só /c: a página abre e confirma sem login; o resto vai para casafiaes.com.br; webhook dá 404", async ({ page, request }) => {
    const v = await visitWithLink({ name: "Hana Link", phone: `${PREFIXO}0006`, startsAt: daysAhead(3, "16:00") });
    await page.goto(`${CLIENT_URL}/c/${v.token}`);
    expect(new URL(page.url()).host).toBe(new URL(CLIENT_URL).host);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oi, Hana! Seu horário na Casa Fiaes");
    await page.getByRole("button", { name: "Confirmar presença" }).click();
    await expect(page.getByText("Pronto! Seu horário está confirmado. Te esperamos!")).toBeVisible();
    expect((await e2eSql("select status from appointments where id = $1", [v.appointmentId]))[0].status).toBe("confirmado");
    expect((await request.get(`${CLIENT_URL}/c/${v.token}/agenda.ics`)).headers()["content-type"]).toContain("text/calendar");
    for (const p of ["/", "/login", "/agenda", "/contatos", "/api/health"]) {
      const r = await request.get(`${CLIENT_URL}${p}`, { maxRedirects: 0 });
      expect(r.status(), p).toBe(307);
      expect(r.headers().location, p).toBe("https://casafiaes.com.br/");
    }
    expect((await request.post(`${CLIENT_URL}/api/webhooks/evolution`, { data: {} })).status()).toBe(404);
    // No host do CRM, o link antigo continua abrindo (mensagens já enviadas).
    expect((await request.get(`/c/${v.token}`, { maxRedirects: 0 })).status()).toBe(200);
  });

  test("o agendamento online abre no endereço da cliente (antes ia para o site da Casa)", async ({ page }) => {
    const [svc] = await e2eSql("insert into lists (kind, label, position, duration_min) values ('service', 'Escova Online E2E', 95, 45) on conflict do nothing returning id");
    const id = svc?.id ?? (await e2eSql("select id from lists where kind = 'service' and label = 'Escova Online E2E'"))[0].id;
    await e2eSql(`insert into settings (key, value) values ('agendamento_online', $1::jsonb) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [id], profissionais: [] })]);
    try {
      await page.goto(`${CLIENT_URL}/agendar`);
      expect(new URL(page.url()).host).toBe(new URL(CLIENT_URL).host);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agendar horário");
      await expect(page.getByLabel("Serviço").locator("option", { hasText: "Escova Online E2E" })).toHaveCount(1);
    } finally {
      await e2eSql("delete from settings where key = 'agendamento_online'");
    }
  });

  test("prévia (Open Graph): marca, sem dado da cliente nem o código; imagem PNG 1200x630; robô da prévia não conta como abertura", async ({ request }) => {
    const v = await visitWithLink({ name: "Iara Link", phone: `${PREFIXO}0007`, startsAt: daysAhead(4, "14:00") });
    const r = await request.get(`${CLIENT_URL}/c/${v.token}`, { headers: { "user-agent": "WhatsApp/2.24.1 A" } });
    const html = await r.text();
    const head = html.slice(0, html.indexOf("</head>"));
    const meta = (prop: string) => head.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
    expect(meta("og:title")).toBe("Seu horário na Casa Fiaes");
    expect(meta("og:description")).toBe("Confirme, remarque ou cancele com um toque.");
    expect(meta("og:image")).toBe(`${CLIENT_URL}/c/marca.png`);
    expect(meta("og:image:width")).toBe("1200");
    expect(meta("og:image:height")).toBe("630");
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(head).toContain("<title>Seu horário na Casa Fiaes</title>");
    const tags = [...head.matchAll(/<(?:meta|title|link)[^>]*>[^<]*/g)].map((m) => m[0]).join("\n");
    for (const s of ["Iara", "Corte E2E", "Maiara", v.token]) expect(tags, s).not.toContain(s);
    expect((await e2eSql("select open_count from client_links where token_hash = $1", [createHash("sha256").update(v.token).digest("hex")]))[0].open_count).toBe(0);
    const img = await request.get(`${CLIENT_URL}/c/marca.png`);
    expect(img.headers()["content-type"]).toBe("image/png");
    const png = await img.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const icon = await request.get(`${CLIENT_URL}/c/icone.png`);
    expect(icon.headers()["content-type"]).toBe("image/png");
  });
});
