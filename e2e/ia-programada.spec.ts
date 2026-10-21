import http from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, isola } from "./helpers";

/**
 * "Escrever com IA" no Retomar/Programar mensagem. A IA é um servidor FALSO local (E2E_AI_BASE_URL, ia-tools/e2e-p.sh): nunca a Anthropic.
 * O texto só entra no campo (editável, com Desfazer); nada é programado sem o botão Programar. Desligada: o botão não aparece.
 */
const AI_URL = process.env.E2E_AI_BASE_URL ?? "";
const FONE = "71 99749-2001", E164 = "+5571997492001";
const ligar = (on: boolean) => e2eSql(`insert into settings (key, value) values ('ia_sugestao', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ enabled: on, monthlyLimitUsd: 40, dailyCalls: 1500 })]);
const dealOf = async () => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [E164]))[0].id);
const count = async (sql: string, p: unknown[] = []) => Number((await e2eSql(sql, p))[0].n);
const diaBahia = (dias: number) => new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

let pedidos: string[] = [];
let server: http.Server | null = null;
test.beforeAll(async () => {
  test.skip(!/^http:\/\/127\.0\.0\.1:\d+\//.test(AI_URL), "sem E2E_AI_BASE_URL local (rode por ia-tools/e2e-p.sh)");
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const user = JSON.parse(body).messages[0].content as string;
      pedidos.push(user);
      const sugestao = `Oii, Paula! Tudo bem? Ficou alguma dúvida do orçamento? (${pedidos.length})`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ resumo: "dúvida", sugestao, precisa_humano: false, motivo: "" }) }],
        usage: { input_tokens: 700, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 60 } }));
    });
  });
  await new Promise<void>((r) => server!.listen(Number(new URL(AI_URL).port), "127.0.0.1", r));
});
test.afterAll(async () => { await ligar(false); await new Promise((r) => (server ? server.close(r) : r(null))); });

async function abrirRetomar(page: Page, dealId: string) {
  await page.goto(`/atendimento/${dealId}`);
  const info = page.getByRole("button", { name: "Ver dados da cliente" });
  if (await info.isVisible()) await info.click();
  await page.getByRole("button", { name: "Retomar…" }).last().click();
  const dlg = page.getByRole("dialog", { name: /^Retomar/ });
  await expect(dlg).toBeVisible();
  return dlg;
}

test("ia programada: o tema vira texto no campo (editável, Desfazer, Gerar de novo); nada é programado; desligada some", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await ligar(true);
  await login(page);
  await isola("+55719974920");
  await simulate(page, { phone: FONE, name: "Paula Reis", text: "Me manda o orçamento da progressiva?" });
  const dealId = await dealOf();
  pedidos = [];

  const dlg = await abrirRetomar(page, dealId);
  await dlg.getByRole("radio", { name: "Escolher" }).click();
  await dlg.getByLabel("Dia").fill(diaBahia(2));
  await dlg.getByLabel("Hora").fill("15:30");
  const campo = dlg.getByLabel("Mensagem (opcional)");
  await campo.fill("meu rascunho");
  await dlg.getByRole("button", { name: "Escrever com IA" }).click();
  await dlg.getByLabel("Sobre o que é a mensagem?").fill("perguntar se ficou alguma dúvida do orçamento");
  await dlg.getByRole("button", { name: "Gerar", exact: true }).click();
  await expect(campo).toHaveValue("Oii, Paula! Tudo bem? Ficou alguma dúvida do orçamento? (1)");
  expect(pedidos[0]).toContain("Tema (pedido da atendente; é o assunto, não o texto pronto): perguntar se ficou alguma dúvida do orçamento");
  expect(pedidos[0]).toMatch(new RegExp(`A mensagem sai: \\S+ ${diaBahia(2).slice(8, 10)}/${diaBahia(2).slice(5, 7)}, 15:30`));
  expect(pedidos[0]).toContain("Cliente: Me manda o orçamento da progressiva?");

  // Editável; "Gerar de novo" pede outra versão; Desfazer volta ao texto anterior.
  await campo.fill("Oii, Paula! Ficou alguma dúvida? Estou aqui.");
  await dlg.getByRole("button", { name: "Gerar de novo" }).click();
  await expect(campo).toHaveValue("Oii, Paula! Tudo bem? Ficou alguma dúvida do orçamento? (2)");
  expect(pedidos[1]).toContain("Escreva uma versão diferente desta:");
  await dlg.getByRole("button", { name: /Desfazer/ }).click();
  await expect(campo).toHaveValue("Oii, Paula! Ficou alguma dúvida? Estou aqui.");

  // Nada foi programado nem enviado; o uso entrou no gasto como "programada".
  expect(await count("select count(*)::int as n from outbox where deal_id = $1", [dealId])).toBe(0);
  expect(await count("select count(*)::int as n from ai_suggestions where origin = 'programada' and created_at > now() - interval '5 minutes'")).toBe(2);
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await count("select count(*)::int as n from outbox where deal_id = $1", [dealId])).toBe(0);

  // Desligada: o botão não aparece.
  await ligar(false);
  const dlg2 = await abrirRetomar(page, dealId);
  await expect(dlg2.getByLabel("Mensagem (opcional)")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(dlg2.getByRole("button", { name: "Escrever com IA" })).toHaveCount(0);
});
