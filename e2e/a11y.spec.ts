import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { login, e2eSql, simulate, ageLead } from "./helpers";

/** T24: axe (wcag2a/aa/22aa) em todas as telas, nos dois projetos e nos dois papéis; mais 16 px nos campos, alvos de 44 px no toque e zero rolagem lateral. */

const PREFIXO = "+557199888";
let lead = { contactId: "", dealId: "" };

test.beforeAll(async () => {
  // Idempotente: o beforeAll roda de novo quando o worker reinicia depois de uma falha.
  const [c] = await e2eSql("insert into contacts (name, phone_e164) values ('Aline Axe', $1) on conflict (phone_e164) do update set name = excluded.name returning id", [`${PREFIXO}0001`]);
  let [d] = await e2eSql("select id from deals where contact_id = $1 and closed_at is null order by created_at desc limit 1", [c.id]);
  if (!d) {
    [d] = await e2eSql("insert into deals (contact_id, stage_id, stage_entered_at) values ($1, (select id from stages where kind = 'agendado' limit 1), now()) returning id", [c.id]);
    await e2eSql("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at) values ($1, $2, 'in', 'text', 'Oi, queria saber o preço', 'received', now())", [d.id, c.id]);
  }
  await e2eSql("update deals set archived_at = null where id = $1", [d.id]);
  lead = { contactId: String(c.id), dealId: String(d.id) };
});
test.afterAll(async () => {
  // Não deixa lead nem aviso para os outros specs (o sino do teste abaixo cria um lead atrasado).
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id = $1 or contact_id in (select id from contacts where phone_e164 = '+5571997004545')", [lead.contactId]);
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

const GESTAO = "gestao@e2e.local";
const ATENDENTE = "ana@e2e.local";
const rotasComuns = ["/", "/atendimento", "/funil", "/contatos", "/relatorios", "/atendimento/<id>", "/contatos/<id>", "/ajuda/avisos"];
const resolve = (r: string) => r.replace(/^\/atendimento\/<id>/, `/atendimento/${lead.dealId}`).replace(/^\/contatos\/<id>/, `/contatos/${lead.contactId}`);
const rotasGestao = ["/jornada", "/config/automacoes", "/config/origens", "/config/whatsapp", "/config/mensagens", "/config/etapas", "/config/equipe", "/config/equipe/perfis", "/config/listas", "/config/etiquetas", "/config/massa", "/config/menu", "/config/chatguru", "/relatorios?aba=salao", "/relatorios/avec", // Lote 5: massa, menu e chatguru
  "/config/profissionais", "/config/profissionais?aba=matriz", "/config/agenda", "/agenda?v=profissionais",
  "/config", "/config?grupo=cuidado", "/config/mensagens?parte=fora-do-horario", "/config/avec", "/config/distribuicao"]; // F5: índice, Área de cuidado e um item

async function varre(page: Page, rotulo: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const graves = r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, impacto: v.impact, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n").slice(1, 3).join(" ").slice(0, 160)}`) }));
  if (process.env.A11Y_DUMP) appendFileSync(process.env.A11Y_DUMP, JSON.stringify({ rotulo, graves }) + "\n");
  expect(graves, rotulo).toEqual([]);
}
async function semRolagemLateral(page: Page, rotulo: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `rolagem lateral em ${rotulo}`).toBeLessThanOrEqual(0);
}
/** `load` mais um heading visível: o SSE nunca deixa a rede ociosa, então nada de networkidle. */
async function abre(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.waitForTimeout(1500); // fim das animações de entrada (contraste calculado no meio do fade dá falso positivo)
}

for (const [papel, email] of [["gestão", GESTAO], ["atendente", ATENDENTE]] as const) {
  test.describe(`a11y (${papel})`, () => {
    for (const nome of email === GESTAO ? [...rotasComuns, ...rotasGestao] : rotasComuns) { // /jornada e /config/* são da gestão (a atendente volta para o Hoje)
      test(nome, async ({ page }) => {
        const path = resolve(nome);
        await login(page, email);
        await abre(page, path);
        await varre(page, `${papel} ${nome}`);
        await semRolagemLateral(page, nome);
        expect(await page.getByRole("heading", { level: 1 }).count(), `um só h1 em ${nome}`).toBe(1);
        expect(await page.getByRole("main").count(), `main em ${nome}`).toBe(1);
      });
    }
  });
}

test("a11y: atendente sem a Jornada volta para o Hoje com aviso (a rota não entra na varredura dela)", async ({ page }) => {
  await login(page, ATENDENTE);
  await page.goto("/jornada");
  await expect(page).toHaveURL(/\/\?aviso=sem-permissao/);
});

test("a11y: sino aberto", async ({ page }) => {
  await login(page, GESTAO);
  await simulate(page, { phone: "71 99700-4545", name: "Bete Sino", text: "Oi, tem horário amanhã?" });
  ageLead("+5571997004545", 11);
  await abre(page, "/");
  await page.getByRole("button", { name: /^Alertas/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Alertas" })).toBeVisible();
  await page.waitForTimeout(500);
  await varre(page, "sino aberto");
});

test("a11y: diálogos Retomar e Mandar orçamento abertos (a Fechar venda saiu, 16/10)", async ({ page }) => {
  await login(page, GESTAO);
  await abre(page, `/atendimento/${lead.dealId}`);
  // Celular e telas estreitas: o painel da cliente abre por "ⓘ Cliente"
  const doPainel = async () => {
    const info = page.getByRole("button", { name: "Ver dados da cliente" });
    if (await info.isVisible()) await info.click();
  };
  await doPainel();
  await page.getByRole("button", { name: "Retomar…" }).last().click();
  await expect(page.getByRole("dialog", { name: /^Retomar/ })).toBeVisible();
  await page.waitForTimeout(500);
  await varre(page, "diálogo retomar");
  await semRolagemLateral(page, "diálogo retomar");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /^Retomar/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Mandar orçamento/ }).last().click();
  await expect(page.getByRole("dialog", { name: "Mandar orçamento" })).toBeVisible();
  await page.waitForTimeout(500);
  await varre(page, "diálogo mandar orçamento");
  await semRolagemLateral(page, "diálogo mandar orçamento");
});

test("a11y: Dialog de envio real aberto", async ({ page }) => {
  const limpa = () => e2eSql("delete from automations where name = 'Parabéns no aniversário'");
  await login(page, GESTAO);
  await limpa();
  try {
    await abre(page, "/config/automacoes?parte=regras"); // F5: as regras são um item próprio
    await page.getByRole("button", { name: "Começar de um modelo" }).click();
    await page.getByTestId("modelo-aniversario").click();
    await expect(page.getByRole("dialog", { name: "Editar automação" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Editar automação" })).toHaveCount(0);
    const sw = page.getByRole("switch", { name: "Ligar Parabéns no aniversário" });
    // No celular, o interruptor pode parar atrás da barra de baixo conforme quantas regras existem (axe: target-size): centraliza antes.
    await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sw.click();
    await expect(page.getByRole("dialog", { name: "Ligar o envio automático?" })).toBeVisible();
    await page.waitForTimeout(500);
    await varre(page, "dialog envio real");
    await page.getByRole("button", { name: "Cancelar" }).click();
  } finally { await limpa(); } // o modelo criado não fica para os outros specs
});

test("celular: campos com 16 px, alvos de 44 px e composer no fundo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "só no celular");
  await login(page, GESTAO);
  const falhas: string[] = [];
  for (const path of ["/", "/atendimento", "/contatos", "/relatorios", `/atendimento/${lead.dealId}`, `/contatos/${lead.contactId}`, "/config", "/config/automacoes", "/config/whatsapp", "/config/mensagens"]) {
    await abre(page, path);
    const r = await page.evaluate(() => {
      const vis = (el: Element) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const campos = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea")].filter(vis)
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => `campo ${el.tagName.toLowerCase()}[${(el as HTMLInputElement).name || el.getAttribute("aria-label") || ""}] ${getComputedStyle(el).fontSize}`);
      const alvos = [...document.querySelectorAll("button, [role=button], [role=tab], [role=switch], [role=option], a[href]")].filter(vis)
        .filter((el) => !el.closest("p, li > p") || el.tagName !== "A")
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width < 43.5 || b.height < 43.5; })
        .filter((el) => !(el.tagName === "A" && el.parentElement && /^(P|SPAN)$/.test(el.parentElement.tagName) && (el.parentElement.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 8))
        .map((el) => { const b = el.getBoundingClientRect(); return `alvo ${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`; });
      return [...campos, ...alvos];
    });
    for (const f of r) falhas.push(`${path}: ${f}`);
  }
  expect(falhas).toEqual([]);
});

test("celular: o composer da conversa em tela cheia continua no fundo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "só no celular");
  await login(page, GESTAO);
  await abre(page, `/atendimento/${lead.dealId}`);
  const campo = page.getByRole("textbox", { name: /mensagem/i }).first();
  await expect(campo).toBeVisible();
  const vp = page.viewportSize()!;
  const b = (await campo.boundingBox())!;
  expect(b.y + b.height).toBeGreaterThan(vp.height - 140);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
});

test("ajuda dos avisos: gerada das mesmas frases da Fila e do sino", async ({ page }) => {
  await login(page, ATENDENTE);
  await page.goto("/ajuda/avisos");
  await expect(page.getByRole("heading", { name: "O que cada aviso quer dizer" })).toBeVisible();
  await expect(page.locator("#fila-atrasados")).toContainText("A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.");
  await expect(page.locator("#alerta-espera")).toContainText("espera resposta desde 14:02 (prazo 15 min)");
  await expect(page.locator("#alerta-respondida")).toContainText("Ela continua sua; se for para passar, use Transferir.");
  await expect(page.locator("#sinal-pediu_preco")).toContainText("Some quando a Casa mandar um valor.");
});

test("ajuda dos avisos: o atalho do topo leva ao assunto sem esconder o título atrás da barra do celular", async ({ page }) => {
  await login(page, ATENDENTE);
  await page.goto("/ajuda/avisos");
  await page.getByRole("navigation", { name: "Assuntos" }).getByRole("link", { name: "Sino" }).click();
  await expect(page).toHaveURL(/#sino$/);
  const titulo = page.getByRole("heading", { level: 2, name: "Sino" });
  await expect(titulo).toBeInViewport();
  const coberto = await titulo.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + 4, b.top + b.height / 2);
    return !(hit && el.contains(hit));
  });
  expect(coberto, "o título do assunto fica atrás da barra fixa do topo").toBe(false);
});
