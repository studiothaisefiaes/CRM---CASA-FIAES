import http from "node:http";
import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, isola, shot } from "./helpers";
import { E2E_WORK_HOURS } from "./seed-agenda";

/**
 * IA marca (pedido do dono, 17/10): a sugestão propõe UM horário concreto (id da lista), a avaliação do Método só com a Thaise, e
 * "Marcar este horário" abre a folha "Marcar horário" PREENCHIDA. Nada é marcado sem o botão Marcar da folha; a confirmação só vai
 * para a caixa de mensagem (nunca é enviada sozinha). A IA é um servidor FALSO local (E2E_AI_BASE_URL, ia-tools/e2e-m.sh): nunca a Anthropic.
 */
const AI_URL = process.env.E2E_AI_BASE_URL ?? "";
const FONE = "71 99740-3001", E164 = "+5571997403001";
const ligar = (on: boolean) => e2eSql(`insert into settings (key, value) values ('ia_sugestao', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ enabled: on, monthlyLimitUsd: 40, dailyCalls: 1500 })]);
const one = async (q: string, p: unknown[] = []) => (await e2eSql(q, p))[0];
const diaBahia = (dias: number) => new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

let pedidos: string[] = [];
let server: http.Server | null = null;
test.beforeAll(async () => {
  test.skip(!/^http:\/\/127\.0\.0\.1:\d+\//.test(AI_URL), "sem E2E_AI_BASE_URL local (rode por ia-tools/e2e-m.sh)");
  // A IA falsa: propõe a 1ª opção da linha "Horários livres" (h1) e devolve o id dela, como a de verdade deve fazer.
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const user = JSON.parse(body).messages[0].content as string;
      pedidos.push(user);
      const m = /(\S+ \d{2}\/\d{2}) (\S+) (\d{1,2}h\d{0,2}) \(h1\)/.exec(user);
      const sugestao = m ? `Que bom que você quer conhecer o Método! Tenho ${m[1]} às ${m[3]} com a ${m[2]}. Posso reservar pra você?` : "Qual dia fica melhor pra você?";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ resumo: "Quer marcar a avaliação do Método.", sugestao, precisa_humano: false, motivo: "", horario: m ? "h1" : "" }) }],
        usage: { input_tokens: 900, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 70 } }));
    });
  });
  await new Promise<void>((r) => server!.listen(Number(new URL(AI_URL).port), "127.0.0.1", r));
});
test.afterAll(async () => { await ligar(false); await new Promise((r) => (server ? server.close(r) : r(null))); });

test("ia marca: avaliação do Método só com a Thaise; 'Marcar este horário' abre a folha preenchida, só marca no Marcar e a confirmação vai para a caixa (nada enviado)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await ligar(true);
  // Como em produção: a AVALIAÇÃO ligada à Thaise E ao Jackson; a regra (migration 0050 / aba Serviços) diz "só a Thaise quando é Método".
  const thaise = String((await one(`insert into professionals (name, work_hours, agenda_position) values ('THAISE FIAES', $1::jsonb, 5) returning id`, [JSON.stringify(E2E_WORK_HOURS)])).id);
  const jackson = String((await one(`insert into professionals (name, work_hours, agenda_position) values ('JACKSON', $1::jsonb, 4) returning id`, [JSON.stringify(E2E_WORK_HOURS)])).id);
  const aval = String((await one(`insert into lists (kind, label, duration_min, price_cents, category, position) values ('service', 'AVALIAÇÃO', 60, 0, 'Cabelo', 90)
    on conflict (kind, label) do update set duration_min = 60 returning id`)).id);
  await e2eSql("insert into professional_services (professional_id, service_id) values ($1, $3), ($2, $3) on conflict do nothing", [thaise, jackson, aval]);
  await e2eSql(`update lists set ai_pro_ids = array[$1::uuid], ai_pro_scope = 'metodo' where id = $2`, [thaise, aval]);

  await login(page);
  await isola("+55719974030");
  await simulate(page, { phone: FONE, name: "Paula Reis", text: "Oi! Quero fazer a avaliação do Método Fiaes. Tem horário amanhã à tarde?" });
  const dealId = String((await one("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [E164])).id);
  const contactId = String((await one("select id from contacts where phone_e164 = $1", [E164])).id);
  const outAntes = Number((await one("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [dealId])).n);
  pedidos = [];

  await page.goto(`/atendimento?lead=${dealId}`);
  const lead = page.getByRole("region", { name: /Conversa com Paula Reis/ });
  await lead.getByRole("button", { name: "Sugerir resposta" }).click();
  const card = lead.getByRole("region", { name: "Sugestão da IA" });
  await expect(card.getByTestId("sugestao-ia")).toContainText("com a Thaise", { timeout: 20_000 });
  // O que a IA recebeu: só a Thaise, cada opção com id; "Agora" com a data completa.
  expect(pedidos.at(-1)).toMatch(/^Horários livres \(AVALIAÇÃO, 1 h\) para \S+ \d{2}\/\d{2} à tarde: .*Thaise 12h \(h1\)/m);
  expect(pedidos.at(-1)).not.toContain("Jackson");
  expect(pedidos.at(-1)).toMatch(/^Agora: \S+, \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \(Salvador\)\./);

  const amanha = diaBahia(1);
  const ddmm = `${amanha.slice(8, 10)}/${amanha.slice(5, 7)}`;
  const proposto = card.getByTestId("horario-proposto");
  await expect(proposto).toContainText(new RegExp(`Horário proposto: \\S+ ${ddmm} às 12h · Thaise Fiaes · Avaliação`));
  await shot(page, "ia-marca-cartao");

  await proposto.getByRole("button", { name: "Marcar este horário" }).click();
  const folha = page.getByRole("dialog", { name: "Marcar horário" });
  await expect(folha).toBeVisible();
  await expect(folha.getByLabel("Serviço 1")).toHaveValue(aval);
  await expect(folha.getByLabel("Profissional 1")).toHaveValue(thaise);
  await expect(folha.getByLabel("Dia")).toHaveValue(amanha);
  await expect(folha.getByLabel("Hora")).toHaveValue("12:00");
  await expect(folha.getByText(/Paula Reis/)).toBeVisible();
  await expect(folha.getByRole("note")).toContainText("Avec"); // modo dupla: "marque também no Avec" continua
  await expect(folha.getByTestId("booking-preview")).toHaveText(/Livre/);
  await shot(page, "ia-marca-folha");
  // Abrir a folha não marca nada.
  expect(Number((await one("select count(*)::int as n from appointments where contact_id = $1", [contactId])).n)).toBe(0);

  await folha.getByRole("radio", { name: "Tanto faz quem atende" }).click();
  await folha.getByRole("button", { name: "Marcar", exact: true }).click();
  await expect(folha).toBeHidden();
  const ap = await one("select professional_id, starts_at, service_id from appointments where contact_id = $1", [contactId]);
  expect(ap).toMatchObject({ professional_id: thaise, service_id: aval });
  expect(new Date(ap.starts_at as string).toISOString()).toBe(new Date(`${amanha}T12:00:00-03:00`).toISOString());
  // Etapa Agendado, como em qualquer marcação pela conversa.
  await expect.poll(async () => (await one("select s.kind from deals d join stages s on s.id = d.stage_id where d.id = $1", [dealId])).kind).toBe("agendado");
  // A confirmação no padrão da Casa vai para a caixa; nada é enviado sozinho.
  const campo = lead.getByRole("textbox", { name: "Mensagem", exact: true });
  // 21/10: no desenho de WhatsApp (data por extenso e hora em negrito, cada uma na sua linha).
  await expect(campo).toHaveValue(new RegExp(`^Confirmado agendamento de Avaliação com Thaise 💛\\n\\n📅 \\*\\S+, ${ddmm}\\*\\n⏰ às \\*12h\\*\\n\\nTemos tolerância de 15 minutos\\.`));
  await expect.poll(async () => (await one("select used_at from ai_suggestions where deal_id = $1 order by created_at desc limit 1", [dealId])).used_at).not.toBeNull();
  await page.waitForTimeout(1200);
  expect(Number((await one("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [dealId])).n)).toBe(outAntes);
  expect(Number((await one("select count(*)::int as n from outbox where deal_id = $1", [dealId])).n)).toBe(0);
  await shot(page, "ia-marca-confirmacao");
});
