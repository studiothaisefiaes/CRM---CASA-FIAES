import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, isola } from "./helpers";

/**
 * Mensagens programadas (Atendimento › Programadas): a lista por dia, Editar (o diálogo do Retomar) e Cancelar (confirmação + Desfazer).
 * As mensagens são gravadas direto no banco como o Retomar grava; nada sai (Evolution morta no e2e). Capturas: PROG_SHOTS_DIR.
 */
const SHOTS = process.env.PROG_SHOTS_DIR;
const diaBahia = (dias: number) => new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
const dealOf = async (e164: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", [e164]))[0].id);
async function programar(dealId: string, text: string, inHours: number) {
  const [g] = await e2eSql("select id from users where email = 'gestao@e2e.local'");
  const [r] = await e2eSql(`insert into outbox (deal_id, kind, text, not_before, created_by, options)
    values ($1, 'text', $2, now() + make_interval(hours => $3), $4, jsonb_build_object('source', 'agendada', 'cancelIfReply', true, 'sendAt', to_char((now() + make_interval(hours => $3)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    returning id`, [dealId, text, inHours, g.id]);
  return String(r.id);
}
const status = async (id: string) => (await e2eSql("select status, error from outbox where id = $1", [id]))[0] as { status: string; error: string | null };
const row = (page: Page, name: string) => page.getByRole("main").getByRole("listitem").filter({ hasText: name });

test("programadas (desktop): aba na Fila, lista por dia, editar e cancelar com Desfazer", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const erros: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(e.message));
  await login(page);
  await isola("+55719974930");
  await simulate(page, { phone: "71 99749-3001", name: "ZULEICA PRADO", text: "Oi! Quanto fica a progressiva?" });
  await simulate(page, { phone: "71 99749-3002", name: "Yasmin Tavares", text: "Vou ver e te falo" });
  const zu = await programar(await dealOf("+5571997493001"), "Oi, Zuleica! Ficou alguma dúvida do orçamento?", 2);
  const ya = await programar(await dealOf("+5571997493002"), "Oi, Yasmin! Conseguiu ver a agenda?", 50);

  await page.setViewportSize({ width: 1366, height: 768 });
  // Hoje (v3): uma linha em Meus combinados; o painel tem as que saem hoje e o "Ver todas".
  await page.goto("/");
  // A da Zuleica sai daqui a 2 h: depois das 22h já é amanhã, e a linha do Hoje só conta as de hoje (o painel sempre leva a todas).
  const hojeAinda = new Date(Date.now() + 2 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Bahia" }) === new Date().toLocaleDateString("en-CA", { timeZone: "America/Bahia" });
  if (hojeAinda) await expect(page.getByRole("region", { name: "Meus combinados" })).toContainText("Mensagens programadas hoje");
  await page.getByRole("button", { name: "Ver todos: Meus combinados" }).click();
  const bloco = page.getByRole("dialog", { name: "Meus combinados" }).getByRole("region", { name: /Mensagens programadas/ });
  if (hojeAinda) await expect(bloco).toContainText("Zuleica Prado");
  await expect(bloco.getByRole("link", { name: /Ver todas/ })).toHaveAttribute("href", "/atendimento/programadas");
  if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/hoje-bloco-1366.png` }); }
  await page.goto("/atendimento");
  // Duas portas: o botão na barra do Atendimento (computador) e a linha embaixo das abas da Fila (sempre que há alguma).
  await expect(page.getByRole("link", { name: /^Programadas \d+$/ })).toHaveCount(2);
  const aba = page.getByRole("link", { name: /^Programadas \d+$/ }).first();
  await expect(aba).toBeVisible();
  if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/fila-aba-1366.png` }); }
  await aba.click();
  await expect(page).toHaveURL(/\/atendimento\/programadas$/);
  await expect(page.getByRole("heading", { name: "Mensagens programadas" })).toBeVisible();

  // A linha: hora, nome em Título, texto, quem programou e o "cancela se responder".
  const z = row(page, "Zuleica Prado");
  await expect(z).toContainText("Oi, Zuleica! Ficou alguma dúvida do orçamento?");
  await expect(z).toContainText("por Thaíse");
  await expect(z).toContainText("Cancela se ela responder antes");
  await expect(row(page, "Yasmin Tavares")).toBeVisible();
  // Filtro "Hoje" (Zuleica sai em 2 h, Yasmin em 50 h) e busca por nome.
  await page.getByRole("link", { name: "Próximos 7 dias" }).click();
  await expect(row(page, "Yasmin Tavares")).toBeVisible();
  await page.getByRole("searchbox", { name: "Buscar por nome" }).fill("yasmin");
  await expect(page).toHaveURL(/q=yasmin/);
  await expect(row(page, "Zuleica Prado")).toHaveCount(0);
  await page.goto("/atendimento/programadas");
  await expect(row(page, "Zuleica Prado")).toBeVisible();
  // A captura antes da hidratação injeta caret-color no campo e o React acusa diferença: espera a tela assentar.
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/programadas-1366.png` });

  // Editar: o diálogo do Retomar abre com o texto e o dia/hora dela; salvar troca pela nova.
  await row(page, "Zuleica Prado").getByRole("button", { name: "Editar" }).click();
  const dlg = page.getByRole("dialog", { name: "Editar mensagem para Zuleica" });
  await expect(dlg).toBeVisible();
  const campo = dlg.getByLabel("Mensagem (opcional)");
  await expect(campo).toHaveValue("Oi, Zuleica! Ficou alguma dúvida do orçamento?");
  await expect(dlg.getByRole("radio", { name: "Escolher" })).toHaveAttribute("aria-checked", "true");
  await dlg.getByLabel("Dia").fill(diaBahia(3));
  await dlg.getByLabel("Hora").fill("11:00");
  await campo.fill("Oi, Zuleica! Passando para lembrar do orçamento da progressiva.");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/programadas-editar-1366.png` });
  await dlg.getByRole("button", { name: "Salvar" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(row(page, "Zuleica Prado")).toContainText("Passando para lembrar do orçamento da progressiva.");
  await expect(row(page, "Zuleica Prado")).toContainText("11:00");
  expect(await status(zu)).toEqual({ status: "cancelled", error: "Editada." });

  // Cancelar: pede confirmação; some da lista; Desfazer traz de volta.
  await row(page, "Yasmin Tavares").getByRole("button", { name: "Cancelar" }).click();
  const conf = page.getByRole("dialog", { name: "Cancelar a mensagem para Yasmin?" });
  await expect(conf).toContainText("Oi, Yasmin! Conseguiu ver a agenda?");
  await conf.getByRole("button", { name: "Cancelar mensagem" }).click();
  await expect(row(page, "Yasmin Tavares")).toHaveCount(0);
  expect((await status(ya)).status).toBe("cancelled");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(row(page, "Yasmin Tavares")).toBeVisible();
  expect((await status(ya)).status).toBe("pending");

  // Cancelada de novo: vai para "Não saíram nas últimas 24 h" (recolhido).
  await row(page, "Yasmin Tavares").getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("dialog", { name: "Cancelar a mensagem para Yasmin?" }).getByRole("button", { name: "Cancelar mensagem" }).click();
  await expect(row(page, "Yasmin Tavares")).toHaveCount(0);
  await page.getByText(/Não saíram nas últimas 24 h/).click();
  await expect(row(page, "Yasmin Tavares")).toContainText("Cancelada em Mensagens programadas");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/programadas-nao-sairam-1366.png` });
  expect(erros.filter((e) => !/Failed to load resource|favicon/.test(e))).toEqual([]);
  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/atendimento/programadas");
    await page.screenshot({ path: `${SHOTS}/programadas-celular-390.png` });
  }
});
