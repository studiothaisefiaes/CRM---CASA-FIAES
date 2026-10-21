import { test, expect, type Page } from "@playwright/test";
import { login, e2eSql, shot } from "./helpers";

/**
 * Hoje › Ao vivo (spec 17/10, pedido do dono: "uma tela ao vivo… para ter o controle total do que está acontecendo aqui na Casa").
 * Um dia só do spec (20/11/2026, longe dos outros specs), visto às 10:20 com `?agora=`: uma coluna por profissional com Agora, Próxima e
 * Depois; a assistente junto da principal; no topo, atrasadas, esperando começar e a receber; fora CLIENTE PADRÃO, espera às 00:00 e cancelado.
 */
const DIA = "2026-11-20";
const em = (hm: string) => `${DIA}T${hm}:00-03:00`;
const AGORA = `/ao-vivo?agora=${encodeURIComponent(em("10:20"))}`;
const PREFIXO = "+5571997960";
const CHAVE = "e2e:aovivo:";
const NOVAS = ["Thaise", "Sidney", "Jamille"];

const proId = async (name: string) => String((await e2eSql("select id from professionals where name = $1", [name]))[0].id);
let n = 0;
async function horario(o: { cliente: string; pro: string; hm: string; min?: number | null; servico?: string; status?: string; comecou?: string; contato?: boolean }) {
  const contactId = o.contato === false ? null
    : String((await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [o.cliente, `${PREFIXO}${String(++n).padStart(3, "0")}`]))[0].id);
  await e2eSql(
    `insert into appointments (contact_id, client_name, professional_id, service_label, starts_at, duration_min, status, origin, external_key, started_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'avec', $8, $9)`,
    [contactId, o.cliente, await proId(o.pro), o.servico ?? "Corte", em(o.hm), o.min === undefined ? 60 : o.min, o.status ?? "agendado", `${CHAVE}${n}:${o.cliente}`, o.comecou ? em(o.comecou) : null]);
}

async function limpa() {
  await e2eSql("delete from appointments where external_key like $1", [`${CHAVE}%`]);
  await e2eSql("delete from contacts where phone_e164 like $1", [`${PREFIXO}%`]);
  await e2eSql("update professionals set assistant_of = null where name = any($1)", [NOVAS]);
  await e2eSql("delete from professionals where name = any($1)", [NOVAS]);
}

test.beforeAll(async () => {
  await limpa();
  await e2eSql("insert into professionals (name, agenda_position, color) values ('Thaise', 0, 'rosa'), ('Sidney', 5, null), ('Jamille', 6, 'oliva')");
  await e2eSql("update professionals set assistant_of = (select id from professionals where name = 'Thaise') where name = 'Sidney'");
  // Thaise: atendendo agora (começou 10:05, 90 min); Sidney, assistente dela, com a próxima já na Casa; depois mais duas.
  await horario({ cliente: "Alice Freitas", pro: "Thaise", hm: "10:00", min: 90, servico: "LUZES E MECHAS", status: "em_atendimento", comecou: "10:05" });
  await horario({ cliente: "Larissa Couto", pro: "Sidney", hm: "10:30", servico: "escova progressiva", status: "chegou" });
  await horario({ cliente: "Rita Souza", pro: "Thaise", hm: "13:00", servico: "Coloração", status: "confirmado" });
  await horario({ cliente: "Bruna Lima", pro: "Thaise", hm: "15:00", servico: "Corte" });
  // Maiara: passou do previsto (9:30 + 45 min); a próxima às 11:00 e mais uma depois.
  await horario({ cliente: "Thamires Domingues", pro: "Maiara", hm: "09:30", min: 45, servico: "Hidratação", status: "em_atendimento", comecou: "09:30" });
  await horario({ cliente: "Paula Mendes", pro: "Maiara", hm: "11:00", servico: "Hidratação", status: "confirmado" });
  await horario({ cliente: "Joana Prado", pro: "Maiara", hm: "14:00" });
  // Bia: livre agora; finalizou uma (a receber) e tem uma atrasada para chegar.
  await horario({ cliente: "Yasmin Rocha", pro: "Bia", hm: "08:30", status: "compareceu" });
  await horario({ cliente: "Suzana Melo", pro: "Bia", hm: "10:00" });
  // Jamille: a cliente chegou e espera começar.
  await horario({ cliente: "Vera Lúcia", pro: "Jamille", hm: "10:15", servico: "Manicure", status: "chegou" });
  // Fora da tela: CLIENTE PADRÃO, espera às 00:00 e cancelado.
  await horario({ cliente: "CLIENTE PADRÃO", pro: "Maiara", hm: "10:00", status: "em_atendimento", contato: false });
  await horario({ cliente: "Gabi Espera", pro: "Bia", hm: "00:00", status: "espera" });
  await horario({ cliente: "Nina Cancelou", pro: "Bia", hm: "12:00", status: "cancelado" });
});
test.afterAll(limpa);

const semPortal = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
const coluna = (page: Page, nome: string) => page.getByRole("region", { name: nome, exact: true });

test("Hoje › Ao vivo: uma coluna por profissional, o topo e o que fica de fora", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Ao vivo" }).click();
  await expect(page).toHaveURL(/\/ao-vivo$/);
  await expect(page.getByRole("region", { name: "Ao vivo" })).toBeVisible();

  await page.goto(AGORA);
  await semPortal(page);
  await expect(page.getByLabel("Agora são 10:20")).toBeVisible();

  const thaise = coluna(page, "Thaise");
  await expect(thaise.getByText("com Sidney", { exact: true })).toBeVisible();
  const agora = thaise.getByTestId("agora");
  await expect(agora.getByText("Alice Freitas")).toBeVisible();
  await expect(agora.getByText("Luzes e Mechas")).toBeVisible();
  await expect(agora.getByText("há 15 min")).toBeVisible();
  await expect(agora.getByText("faltam 1h15")).toBeVisible();
  await expect(agora.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  const proxima = thaise.getByTestId("proxima");
  await expect(proxima.getByText("10:30")).toBeVisible();
  await expect(proxima.getByText("Larissa Couto")).toBeVisible();
  await expect(proxima.getByText("Escova progressiva, com Sidney")).toBeVisible();
  await expect(proxima.getByText("já está na Casa")).toBeVisible();
  await expect(thaise.getByText("Depois: 2 clientes")).toBeVisible();

  const maiara = coluna(page, "Maiara");
  await expect(maiara.getByText("passou 5 min do previsto")).toBeVisible();
  await expect(maiara.getByTestId("proxima").getByText("Paula Mendes")).toBeVisible();
  await expect(maiara.getByText("Depois: 1 cliente")).toBeVisible();
  await expect(coluna(page, "Bia").getByText("Livre agora")).toBeVisible();
  await expect(coluna(page, "Bia").getByText("1 finalizada")).toBeVisible();
  await expect(coluna(page, "Bia").getByTestId("proxima").getByText("passou 20 min, sem Chegou")).toBeVisible();

  const topo = page.getByRole("region", { name: "Agora na Casa" });
  await expect(topo.getByTestId("topo-esperando")).toContainText("2 esperando começar: Vera Lúcia, Larissa Couto");
  await expect(topo.getByTestId("topo-receber")).toContainText("1 a receber: Yasmin Rocha");
  await expect(topo.getByTestId("topo-atrasadas")).toContainText("1 atrasada para chegar: Suzana Melo");

  for (const fora of ["CLIENTE PADRÃO", "Gabi Espera", "Nina Cancelou"]) await expect(page.getByText(fora)).toHaveCount(0);
  await shot(page, "ao-vivo-desktop");

  // Tocar na cliente abre a visita do dia (com a comanda, porque o caixa do e2e está no CRM).
  await agora.getByRole("button", { name: "Abrir a visita de Alice Freitas" }).click();
  const visita = page.getByRole("dialog", { name: "Alice Freitas" });
  await expect(visita.getByText(/Visita de hoje/)).toBeVisible();
  await expect(visita.getByRole("button", { name: "Finalizar" })).toBeVisible();
  await expect(visita.getByRole("button", { name: /comanda/ })).toBeVisible();
  await shot(page, "ao-vivo-visita");
});

test("Tela cheia usa a Fullscreen API e sai de novo", async ({ page }) => {
  await login(page);
  await page.goto(AGORA);
  await semPortal(page);
  await page.getByRole("button", { name: "Tela cheia" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("aria-label") ?? null)).toBe("Ao vivo");
  await expect(page.getByRole("button", { name: "Sair da tela cheia" })).toBeVisible();
  await shot(page, "ao-vivo-tela-cheia");
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("no celular, as colunas rolam de lado sem a página rolar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(AGORA);
  await semPortal(page);
  await expect(coluna(page, "Thaise")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "ao-vivo-celular-390");
});
