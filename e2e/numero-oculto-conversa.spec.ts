import { test, expect } from "@playwright/test";
import { login, e2eSql, isola } from "./helpers";

/** 17/10 (caso MANOELA): mensagem enviada pelo ChatGuru que chegou só com o @lid aparece na conversa da cliente para a equipe juntar. */
const PREFIXO = "+5571997172";
const fone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;

test.beforeEach(async ({ page }) => {
  await login(page);
  await isola(PREFIXO);
});

test("mensagem do ChatGuru que chegou só com o @lid: a conversa da cliente mostra e “É dela” traz para cá", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  // A cliente (pelo número) e o eco da Cati pelo ChatGuru num contato "Número oculto" (como o caso de 17/10).
  const [cli] = await e2eSql("insert into contacts (name, phone_e164, is_client) values ('Manuela Ficticia', $1, true) returning id", [fone(5)]);
  const lid = `2673${Date.now()}`;
  const [oculto] = await e2eSql("insert into contacts (phone_e164, wa_lid) values ($1, $2) returning id", [`lid:${lid}`, lid]);
  const [{ id: lead }] = await e2eSql("insert into deals (contact_id, stage_id, origin) values ($1, (select id from stages where key = 'atendimento'), 'WhatsApp') returning id", [oculto.id]);
  await e2eSql(`insert into messages (deal_id, contact_id, direction, body, from_phone, sent_via, sent_by_user_id, external_id)
    values ($1, $2, 'out', '*GESTAO - CASA FIAES:* Olá! Passando para lembrar do seu horário', true, 'celular', (select id from users where email = 'gestao@e2e.local'), $3)`, [lead, oculto.id, `E2E-LID-${lid}`]);

  await page.goto(`/contatos/${cli.id}`);
  await page.getByRole("button", { name: "Iniciar conversa" }).click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}\?compose=1/);
  const faixa = page.getByRole("group", { name: "Mensagem enviada por outro aparelho" });
  await expect(faixa).toContainText("Passando para lembrar do seu horário");
  await faixa.getByRole("button", { name: /É dela/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mensagem trazida para esta conversa" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Mensagens" }).getByText("Passando para lembrar do seu horário")).toBeVisible();
  await expect(faixa).toHaveCount(0);
  const abertas = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null and d.closed_at is null", [fone(5)]);
  expect(abertas).toHaveLength(1);
  expect((await e2eSql("select wa_lid from contacts where id = $1", [cli.id]))[0].wa_lid).toBe(lid);
});
