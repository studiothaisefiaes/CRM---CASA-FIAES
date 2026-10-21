import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, isola, shot } from "./helpers";

const leadId = async (phoneE164: string) =>
  String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [phoneE164]))[0].id);
const waiting = async (id: string) => (await e2eSql("select awaiting_reply_since is not null as w from deals where id = $1", [id]))[0].w as boolean;

test("Registrar ligação feita pela Casa: não atendida (continua esperando) e atendida com o que foi falado; nada vai pelo WhatsApp", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997521");
  await simulate(page, { phone: "71 99752-1001", name: "Cliente Ligação Feita", text: "Qual o valor da escova?" });
  const id = await leadId("+5571997521001");
  await page.goto(`/atendimento?lead=${id}`);
  await expect(page.getByRole("region", { name: /Conversa com Cliente Ligação Feita/ })).toBeVisible();

  // Não atendeu: pelo telefone discreto ao lado do nome.
  await page.getByRole("button", { name: "Registrar ligação feita" }).click();
  let dlg = page.getByRole("dialog", { name: "Registrar ligação" });
  await expect(dlg).toContainText("Não envia nada para a cliente");
  await dlg.getByRole("radio", { name: "Não atendeu" }).click();
  await dlg.getByRole("button", { name: "Salvar ligação" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("ligacao").first()).toContainText("Ligação feita · não atendida");
  await expect(page.getByTestId("ligacao").first()).toContainText("registrada por");
  expect(await waiting(id)).toBe(true);

  // Atendeu: pelo ⋯, com o que foi falado; depois oferece Marcar horário.
  await page.getByRole("button", { name: "Mais ações", exact: true }).click();
  await page.getByRole("menuitem", { name: "Registrar ligação" }).click();
  dlg = page.getByRole("dialog", { name: "Registrar ligação" });
  await dlg.getByRole("radio", { name: "Atendeu", exact: true }).click();
  await dlg.getByLabel("Assunto (opcional)").fill("Agendamento");
  await dlg.getByLabel("O que foi falado").fill("marcou escova sábado 10h");
  await dlg.getByLabel("Duração em minutos (opcional)").fill("4");
  await dlg.getByRole("button", { name: "Salvar ligação" }).click();
  const ok = page.getByRole("dialog", { name: "Ligação registrada" });
  await expect(ok.getByRole("button", { name: "Marcar horário" })).toBeVisible();
  await shot(page, "ligacao-feita-registrada");
  await ok.getByRole("button", { name: "Pronto" }).click();
  const card = page.getByTestId("ligacao-card").last();
  await expect(card).toContainText("Ligação feita · atendida · 4 min");
  await expect(card).toContainText("marcou escova sábado 10h");
  await expect.poll(() => waiting(id)).toBe(false);

  const rows = await e2eSql("select m.call->>'status' as s, m.sent_by_user_id is not null as autora from messages m where m.deal_id = $1 and m.kind = 'call' order by m.created_at", [id]);
  expect(rows).toEqual([{ s: "perdida", autora: true }, { s: "atendida", autora: true }]);
  expect(Number((await e2eSql("select count(*)::int as n from outbox where deal_id = $1", [id]))[0].n)).toBe(0);
  expect(Number((await e2eSql("select count(*)::int as n from audit_log where action = 'registrou_ligacao' and entity_id = $1", [id]))[0].n)).toBe(2);

  await page.goto("/atendimento");
  await expect(page.getByText("Ligação feita · atendida · 4 min · Agendamento").first()).toBeVisible();
});

test("Ligação recebida sem resultado: Foi atendida (tira a espera, com Desfazer) e Foi perdida (vermelho, continua esperando)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997522");
  await simulate(page, { phone: "71 99752-2001", name: "Cliente Ligação Recebida", text: "Oi" });
  const id = await leadId("+5571997522001");
  // Como o webhook grava a ligação que terminou sem o "accept" (atendida no celular não avisa): "recebida", abrindo a espera.
  await e2eSql(`insert into messages (deal_id, contact_id, direction, kind, body, status, external_id, call, created_at)
    select d.id, d.contact_id, 'in', 'call', 'Ligação recebida', 'received', 'call:e2e-rec', '{"video":false,"status":"recebida"}'::jsonb, now() from deals d where d.id = $1`, [id]);
  await e2eSql("update deals set awaiting_reply_since = now() - interval '1 minute', last_inbound_at = (select created_at from messages where external_id = 'call:e2e-rec') where id = $1", [id]);
  await page.goto(`/atendimento?lead=${id}`);
  const row = page.getByTestId("ligacao");
  await expect(row).toContainText("Ligação recebida");

  await page.getByRole("button", { name: "Foi atendida" }).click();
  await expect(row).toContainText("Ligação recebida · atendida");
  await expect.poll(() => waiting(id)).toBe(false);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(row).toHaveText(/Ligação recebida · \d/);
  await expect.poll(() => waiting(id)).toBe(true);

  await page.getByRole("button", { name: "Foi perdida" }).click();
  await expect(row).toContainText("Ligação perdida");
  await expect(row).toHaveClass(/text-alert/);
  expect(await waiting(id)).toBe(true);
  // Trocar depois pelo menu discreto.
  await page.getByRole("button", { name: "Trocar resultado da ligação" }).click();
  await page.getByRole("menuitem", { name: "Foi atendida" }).click();
  await expect(row).toContainText("Ligação recebida · atendida");
  await expect.poll(() => waiting(id)).toBe(false);
  await shot(page, "ligacao-recebida-marcada");
  expect(Number((await e2eSql("select count(*)::int as n from audit_log where action = 'marcou_ligacao'"))[0].n)).toBeGreaterThanOrEqual(4);
});
