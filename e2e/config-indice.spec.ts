import { test, expect, type Page } from "@playwright/test";
import { login, e2eSql, shot } from "./helpers";

/** F5 (nova organização, 16/10): Configurações em grupos numa coluna, busca, estado de cada item e a Área de cuidado. */
test.describe.configure({ mode: "serial" });

const limpa = () => e2eSql("delete from settings where key in ('auto_resposta')");
test.beforeEach(limpa);
test.afterAll(limpa);

const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("índice: abre em Mensagens automáticas, cada item com frase e estado; a resposta fora do horário ligada aparece ligada", async ({ page }) => {
  await login(page);
  await page.goto("/config");
  const nav = page.getByRole("navigation", { name: "Grupos de configuração" });
  await expect(nav.getByRole("link")).toHaveCount(8);
  await expect(nav.getByRole("link", { name: /^Mensagens automáticas/ })).toHaveAttribute("aria-current", "page");
  const lista = page.getByRole("region", { name: "Mensagens automáticas" });
  await expect(lista.getByRole("note")).toContainText("Tudo aqui pode mandar mensagem para cliente");
  const fora = lista.getByRole("link", { name: /^Resposta fora do horário/ });
  await expect(fora).toContainText("Responde sozinha quem escreve com a Casa fechada");
  await expect(fora.locator("[data-state]")).toHaveAttribute("data-state", "desligado");

  await e2eSql("insert into settings (key, value) values ('auto_resposta', $1)", [JSON.stringify({ enabled: true, text: "Oi, {nome}! A Casa abre às 9h." })]);
  await page.reload();
  await expect(fora.locator("[data-state]")).toHaveAttribute("data-state", "ligado");
  await expect(fora.locator("[data-state]")).toHaveText("Ligada");
  await expect(nav.getByRole("link", { name: /^Mensagens automáticas/ })).toContainText(/\d+ de \d+ ligadas?/);
  expect(await semRolagemLateral(page)).toBe(true);
  await shot(page, "f5-indice-mensagens");

  await fora.click();
  await expect(page).toHaveURL(/\/config\/mensagens\?parte=fora-do-horario$/);
  await expect(page.getByRole("heading", { name: "Resposta fora do horário", level: 1 })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Desligar a resposta fora do horário" })).toBeVisible(); // o formulário de sempre
  await page.getByRole("link", { name: "Configurações · Mensagens automáticas" }).click();
  await expect(page).toHaveURL(/\/config\?grupo=mensagens$/);
});

test("busca: por nome, frase e sinônimo, sem acento; nada encontrado diz o que tentar", async ({ page }) => {
  await login(page);
  await page.goto("/config?grupo=casa");
  const busca = page.getByRole("searchbox", { name: "Procurar configuração" });
  const resultado = page.getByRole("region", { name: "Resultado da busca" });
  await busca.fill("lembrete");
  await expect(resultado.getByRole("link").first()).toContainText("Lembrete do horário");
  await busca.fill("robo");
  await expect(resultado.getByRole("link", { name: /Boas-vindas/ }).first()).toBeVisible();
  await busca.fill("agendar mensagem");
  await expect(resultado.getByRole("link", { name: /Respostas prontas/ })).toBeVisible();
  await busca.fill("chatguru");
  // Importar conversas antigas e Virada (Fase B) citam o ChatGuru.
  await expect(resultado.getByRole("link")).toHaveCount(2);
  await expect(resultado.getByRole("link", { name: /Importar conversas antigas/ })).toContainText("Trazer dados"); // Importar fica fora da Área de cuidado
  await busca.fill("xyzw");
  await expect(page.getByText("Nada com “xyzw”.")).toBeVisible();
  await page.getByRole("button", { name: "Limpar busca" }).last().click();
  await expect(page.getByRole("region", { name: "A Casa" })).toBeVisible();
});

test("Área de cuidado: separada, e o modo do Avec só destrava confirmando; o intervalo da agenda não mostra o modo", async ({ page }) => {
  await login(page);
  await page.goto("/config?grupo=cuidado");
  const lista = page.getByRole("region", { name: "Área de cuidado" });
  await expect(lista.getByRole("note")).toContainText("Mexer aqui pode parar o atendimento");
  await expect(lista.getByRole("link")).toHaveCount(2);
  const modos = () => e2eSql("select key, value from settings where key in ('agenda_modo', 'caixa_modo') order by key");
  const antes = await modos();
  await lista.getByRole("link", { name: /^Ligação com o Avec/ }).click();
  await expect(page).toHaveURL(/\/config\/avec$/);
  const radio = page.locator("input[name=agenda-modo]:not(:checked)").first(); // um modo que não é o de agora
  await expect(page.locator("[data-travado]")).toHaveCount(1);
  const valor = await radio.getAttribute("value");
  await expect(page.locator(`input[name=agenda-modo][value=${valor}]`)).not.toBeChecked();
  await page.locator(`input[name=agenda-modo][value=${valor}]`).click({ force: true, timeout: 2_000 }).catch(() => {}); // travado (inert): o clique não chega
  await expect(page.locator(`input[name=agenda-modo][value=${valor}]`)).not.toBeChecked();
  await page.getByRole("button", { name: "Quero mexer aqui" }).click();
  await page.getByRole("button", { name: "Sim, liberar" }).click();
  await expect(page.locator("[data-travado]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Travar de novo" })).toBeVisible();
  // Nada salvo: o modo continua o de antes
  expect(await modos()).toEqual(antes);

  await page.goto("/config/agenda");
  await expect(page.getByRole("heading", { name: "Intervalo da agenda", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Passo da grade e das sugestões")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.goto("/config/caixa");
  await expect(page.getByRole("switch", { name: "Exigir caixa aberto para fechar comanda" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
});

test("Pessoas num lugar só: equipe, quem recebe conversa nova e perfis", async ({ page }) => {
  await login(page);
  await page.goto("/config?grupo=pessoas");
  await page.getByRole("region", { name: "Pessoas" }).getByRole("link", { name: /^Pessoas/ }).click();
  await expect(page).toHaveURL(/\/config\/equipe$/);
  const partes = page.getByRole("navigation", { name: "Pessoas" });
  for (const n of ["Pessoas", "Quem recebe conversa nova", "Perfis de acesso"]) await expect(partes.getByRole("link", { name: n, exact: true })).toBeVisible();
  await partes.getByRole("link", { name: "Quem recebe conversa nova" }).click();
  await expect(page).toHaveURL(/\/config\/distribuicao$/);
  await expect(page.getByRole("heading", { name: "Pessoas", level: 1 })).toBeVisible();
});

test("celular 390: grupo escolhido numa lista que abre para baixo, sem rolagem lateral", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/config");
  expect(await semRolagemLateral(page)).toBe(true);
  await expect(page.getByRole("navigation", { name: "Grupos de configuração" })).toBeHidden();
  await page.getByText("Grupo", { exact: true }).click();
  await page.getByRole("group").getByRole("link", { name: "Conversas", exact: true }).click(); // a barra de baixo também tem Conversas
  await expect(page).toHaveURL(/\/config\?grupo=conversas$/);
  await expect(page.getByRole("region", { name: "Conversas" }).getByRole("link", { name: /^Respostas prontas/ })).toBeVisible();
  expect(await semRolagemLateral(page)).toBe(true);
  await shot(page, "f5-m-indice-conversas");
  await page.getByRole("region", { name: "Conversas" }).getByRole("link", { name: /^Etiquetas/ }).click();
  await expect(page.getByRole("heading", { name: "Etiquetas", level: 1 })).toBeVisible();
  const voltar = page.getByRole("link", { name: "Configurações · Conversas" });
  expect((await voltar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await semRolagemLateral(page)).toBe(true);
});
