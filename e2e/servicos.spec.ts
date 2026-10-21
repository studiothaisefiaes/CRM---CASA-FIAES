import { test, expect, type Page } from "@playwright/test";
import { login, e2eSql, shot } from "./helpers";

// Aba Serviços (pedido do dono, 16/10): aba do menu principal, fora de Configurações. Gestão e recepção mudam; a atendente só consulta.
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const svc = async (label: string) => (await e2eSql("select * from lists where kind = 'service' and label = $1", [label]))[0];

test.describe.configure({ mode: "serial" });

test("Serviços (desktop): no menu, preço na linha, painel grande com tudo, novo serviço e desativar", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const nome = "Escova e2e";
  const antes = await svc("Corte");
  try {
    await login(page);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Serviços e pacotes" }).click();
    await expect(page).toHaveURL(/\/servicos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();

    // Preço na própria linha.
    const preco = page.getByLabel("Preço de Corte", { exact: true });
    await preco.fill("130,00");
    await preco.press("Enter");
    await page.getByRole("group", { name: "Confirmar novo preço de Corte" }).getByRole("button", { name: "Salvar" }).click();
    await expect.poll(async () => (await svc("Corte")).price_cents).toBe(13_000);

    // Painel grande: duração, descrição, quem faz e retorno.
    await page.getByRole("button", { name: /^Corte/ }).first().click();
    const d = page.getByRole("dialog", { name: "Corte" });
    await expect(d).toBeVisible();
    const box = await d.boundingBox();
    expect(box!.width).toBeGreaterThan(1440 * 0.6); // ~70% da tela
    await d.getByLabel("Duração (min)").fill("45");
    await d.getByLabel("Descrição curta").fill("Inclui lavagem e secagem.");
    await d.getByLabel("Lembrar retorno em (dias)").fill("90");
    await d.getByRole("group", { name: /^Quem faz/ }).getByRole("checkbox", { name: "Bia" }).check();
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(d).toHaveCount(0);
    await expect.poll(async () => { const r = await svc("Corte"); return [r.duration_min, r.description, r.cycle_days]; }).toEqual([45, "Inclui lavagem e secagem.", 90]);
    expect((await e2eSql("select p.name from professional_services ps join professionals p on p.id = ps.professional_id join lists l on l.id = ps.service_id where l.label = 'Corte' order by 1")).map((r) => r.name)).toEqual(expect.arrayContaining(["Bia", "Maiara"]));
    await expect(page.getByText("Inclui lavagem e secagem.")).toBeVisible();

    // Novo serviço (a única ação dourada).
    await page.getByRole("button", { name: "Novo serviço" }).click();
    const n = page.getByRole("dialog", { name: "Novo serviço" });
    await n.getByLabel("Nome").fill(nome);
    await n.getByLabel("Categoria").selectOption({ label: "Nova categoria…" });
    await n.getByLabel("Nome da nova categoria").fill("Cabelo");
    await n.getByLabel("Preço (R$)").fill("125");
    await n.getByRole("button", { name: "Criar serviço" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Cabelo/ })).toBeVisible();
    await expect.poll(async () => (await svc(nome))?.price_cents).toBe(12_500);

    // Desativar na linha: some da lista e aparece em Desativados.
    await page.getByRole("switch", { name: `Desativar ${nome}` }).click();
    await expect.poll(async () => (await svc(nome)).active).toBe(false);
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(nome) })).toHaveCount(0);
    await page.getByRole("button", { name: /Desativados/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(nome) })).toBeVisible();

    // Configurações: só o atalho; o endereço antigo leva para a aba.
    await page.goto("/config?grupo=agenda");
    await expect(page.getByRole("link", { name: /Serviços/ }).first()).toHaveAttribute("href", "/servicos");
    await page.goto("/config/listas?aba=service");
    await expect(page).toHaveURL(/\/servicos$/);
  } finally {
    await e2eSql("delete from lists where kind = 'service' and label = $1", [nome]);
    await e2eSql("update lists set price_cents = $2, duration_min = $3, description = null, cycle_days = $4 where id = $1", [antes.id, antes.price_cents, antes.duration_min, antes.cycle_days]);
    await e2eSql("delete from professional_services ps using professionals p where p.id = ps.professional_id and p.name = 'Bia' and ps.service_id = $1", [antes.id]);
  }
});

test("Serviços: a atendente só consulta (sem Novo serviço, sem campo de preço)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page, "ana@e2e.local");
  await page.goto("/servicos");
  await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
  await expect(page.getByText(/só consulta/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo serviço" })).toHaveCount(0);
  await expect(page.getByLabel(/Preço de/)).toHaveCount(0);
  await page.getByRole("button", { name: /^Corte/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Corte" }).getByRole("textbox")).toHaveCount(0);
});

test("Serviços (celular 390): sem rolagem lateral, no Mais, preço e painel em tela cheia", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("dialog", { name: "Mais" }).getByRole("link", { name: "Serviços e pacotes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
  expect(await semRolagemLateral(page)).toBe(true);
  const alvo = await page.getByLabel("Preço de Corte", { exact: true }).boundingBox();
  expect(alvo!.height).toBeGreaterThanOrEqual(40);
  await page.getByRole("button", { name: /^Corte/ }).first().click();
  const box = await page.getByRole("dialog", { name: "Corte" }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(389);
  expect(await semRolagemLateral(page)).toBe(true);
});

// Pacotes na mesma tela (pedido do dono, 16/10): abas Serviços · Pacotes · Fidelidade; "Com pacote" é aba de Clientes e /pacotes leva para lá.
test("Pacotes (desktop): abas no topo, Novo pacote no painel grande, cartão com preço e sessões, 'Também em pacote' no serviço e clientes filtradas", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const nome = "Combo Cortes e2e";
  const corte = await svc("Corte");
  try {
    await login(page);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Pacotes", exact: true })).toHaveCount(0);
    await page.goto("/servicos");
    const abas = page.getByRole("navigation", { name: "Serviços e pacotes" });
    await expect(abas.getByRole("link", { name: /^Serviços/ })).toHaveAttribute("aria-current", "page");
    await abas.getByRole("link", { name: /^Pacotes/ }).click();
    await expect(page).toHaveURL(/aba=pacotes/);

    await page.getByRole("button", { name: "Novo pacote" }).click();
    const n = page.getByRole("dialog", { name: "Novo pacote" });
    await expect(n).toBeVisible();
    expect((await n.boundingBox())!.width).toBeGreaterThan(1440 * 0.6);
    await n.getByLabel("Nome").fill(nome);
    await n.getByLabel("Serviço 1").selectOption({ label: "Corte" });
    await n.getByLabel("Sessões de Corte", { exact: true }).fill("4");
    await n.getByLabel("Preço do pacote (R$)").fill("400");
    await expect(n.getByText(/R\$\s100,00 por sessão/)).toBeVisible();
    await n.getByLabel("Validade (dias)").fill("90");
    await n.getByLabel("Descrição para a IA").fill("Um corte por mês.");
    await n.getByRole("button", { name: "Criar pacote" }).click();
    await expect(n).toHaveCount(0);
    const def = async () => (await e2eSql("select * from package_defs where name = $1", [nome]))[0];
    await expect.poll(async () => { const d = await def(); return d && [d.price_cents, d.validity_days, d.description, d.items]; })
      .toEqual([40_000, 90, "Um corte por mês.", [{ serviceId: corte.id, sessions: 4, unitCents: null }]]);

    // Uma cliente com o pacote ativo → o cartão mostra e leva à aba das clientes, só com esse pacote.
    const d = await def();
    const cid = (await e2eSql("insert into contacts (name, phone_e164) values ('Carla Pacote', '+5571988776611') on conflict (phone_e164) do update set name = excluded.name returning id"))[0].id;
    await e2eSql(`insert into client_packages (contact_id, client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, origin, external_key, package_def_id)
      values ($1, 'Carla Pacote', $2, 'Corte', 4, 1, 40000, current_date - 10, current_date + 80, 'crm', 'e2e:pac:' || gen_random_uuid(), $3)`, [cid, nome, d.id]);
    await page.reload();
    const card = page.getByRole("article", { name: nome });
    await expect(card.getByText("4 sessões")).toBeVisible();
    await expect(card.getByText(/R\$\s400,00/)).toBeVisible();
    await expect(card.getByText("Vale 90 dias")).toBeVisible();
    await card.getByRole("link", { name: "1 cliente com o pacote ativo" }).click();
    await expect(page).toHaveURL(new RegExp(`/contatos\\?vista=pacote&pacote=${d.id}`));
    await expect(page.getByRole("navigation", { name: "Clientes" }).getByRole("link", { name: "Com pacote" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Principal" }).first().getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(nome).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Pacotes" }).getByRole("listitem")).toHaveCount(1);

    await page.goto("/servicos");
    // No serviço: "Também em pacote", na linha e no painel (o link abre o pacote).
    await abas.getByRole("link", { name: /^Serviços/ }).click();
    await expect(page.getByText(new RegExp(`Também em pacote: ${nome} · 4 sessões · R\\$\\s400,00`))).toBeVisible();
    await page.getByRole("button", { name: /^Corte/ }).first().click();
    await page.getByRole("dialog", { name: "Corte" }).getByRole("link", { name: new RegExp(nome) }).click();
    await expect(page.getByRole("dialog", { name: nome })).toBeVisible();

    // Endereços antigos: /pacotes e /servicos?aba=clientes levam para Clientes › Com pacote, com os filtros.
    await page.goto("/pacotes?situacao=todos&q=carla");
    await expect(page).toHaveURL(/\/contatos\?vista=pacote&situacao=todos&q=carla$/);
    await expect(page.getByRole("searchbox", { name: "Buscar cliente ou pacote" })).toHaveValue("carla");
  } finally {
    await e2eSql("delete from client_packages where package_name = $1", [nome]);
    await e2eSql("delete from contacts where phone_e164 = '+5571988776611'");
    await e2eSql("delete from package_defs where name = $1", [nome]);
  }
});

test("IA: 'O que a IA sabe sobre a Casa' salva as seções do manual", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  try {
    await login(page);
    await page.goto("/config/ia");
    await expect(page.getByRole("heading", { name: "O que a IA sabe sobre a Casa" })).toBeVisible();
    await page.getByLabel("Regras da Casa").fill("Tolerância de atraso: 15 minutos.\nSinal: [a Casa precisa preencher]");
    await expect(page.getByText("1 item para a Casa preencher")).toBeVisible();
    await page.getByRole("button", { name: "Salvar o manual" }).click();
    await expect.poll(async () => (await e2eSql("select value->'secoes'->>'regras' as regras from settings where key = 'ia_manual_casa'"))[0]?.regras).toBe("Tolerância de atraso: 15 minutos.\nSinal: [a Casa precisa preencher]");
    await expect(page.getByRole("button", { name: "Salvar o manual" })).toHaveCount(0); // r68 #10: salvo, sem botão cinza
    await expect(page.getByText("Tudo salvo")).toBeVisible();
  } finally {
    await e2eSql("delete from settings where key = 'ia_manual_casa'");
  }
});

// Capturas (CF_SHOTS_DIR) com um catálogo fictício: 1366x768 e 390x844, lista e painel.
test("Serviços: capturas com dados fictícios", async ({ page, isMobile }) => {
  test.skip(isMobile || !process.env.CF_SHOTS_DIR, "só para as capturas");
  const FAKE = [
    ["Manutenção Método Fiaes", "METODO FIAES", 247_500, 240, "Remoção, confecção com queratina nova, lavagem especial, aplicação e finalização."],
    ["Aplicação Método Fiaes", "METODO FIAES", 247_500, 300, "Aplicação das microcápsulas com o fio novo, 100% natural."],
    ["Retirada Método Fiaes", "METODO FIAES", 30_000, 90, "Retirada das cápsulas e lavagem."],
    ["Corte Feminino", "CABELO", 26_400, 60, "Lavagem especial, corte e secagem."],
    ["Escova", "FINALIZAÇÃO", 12_000, 45, null],
    ["Luzes e Mechas", "COR", 115_800, 180, "Luzes, mechas, balayage e reflexos."],
    ["Coloração ou Tonalização", "COR", 33_000, null, null],
    ["Ritual de Tratamento", "RITUAL DE TRATAMENTO", 35_800, 60, "Hidratação, nutrição ou reconstrução."],
    ["Manicure", "MANICURE E PEDICURE", 6_000, 45, null],
    ["Pedicure", "MANICURE E PEDICURE", 6_000, 50, null],
    ["Spa para os Pés", "MANICURE E PEDICURE", 15_000, 60, null],
  ] as const;
  const pros = ["Joana Prado", "Lívia Rocha", "Carla Nunes", "Renata Dias", "Paula Mello"];
  try {
    await e2eSql("update lists set active = false where kind = 'service'");
    for (const [label, cat, price, dur, desc] of FAKE)
      await e2eSql("insert into lists (kind, label, category, price_cents, duration_min, description, position) values ('service', $1, $2, $3, $4, $5, 900)", [label, cat, price, dur, desc]);
    for (const [i, p] of pros.entries()) await e2eSql("insert into professionals (name, color) values ($1, $2)", [p, ["ameixa", "oceano", "rosa", "musgo", "caramelo"][i]]);
    await e2eSql(`insert into professional_services (professional_id, service_id) select p.id, l.id from professionals p, lists l
      where l.kind = 'service' and l.position = 900 and ((p.name in ('Joana Prado', 'Lívia Rocha', 'Carla Nunes') and l.category in ('METODO FIAES', 'CABELO', 'COR', 'FINALIZAÇÃO', 'RITUAL DE TRATAMENTO'))
      or (p.name in ('Renata Dias', 'Paula Mello') and l.category = 'MANICURE E PEDICURE')) on conflict do nothing`);
    await login(page);
    for (const [w, h, tag] of [[1366, 768, "1366"], [390, 844, "390"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/servicos");
      await expect(page.getByRole("heading", { level: 2, name: /Método Fiaes/ })).toBeVisible();
      await shot(page, `servicos-${tag}-lista`);
      await page.getByRole("button", { name: /^Manutenção Método Fiaes/ }).click();
      await expect(page.getByRole("dialog", { name: "Manutenção Método Fiaes" })).toBeVisible();
      await shot(page, `servicos-${tag}-painel`);
    }
    // Pacotes fictícios (preço do pacote inteiro, sessões, validade) e clientes com pacote.
    await page.setViewportSize({ width: 1366, height: 768 });
    const id = async (label: string) => (await e2eSql("select id from lists where kind = 'service' and position = 900 and label = $1", [label]))[0].id;
    const PACKS = [
      ["Combo Manutenção Método Fiaes", 800_000, 365, "4 manutenções completas, uma a cada 3 meses. Parcela em até 10x sem juros.", [["Manutenção Método Fiaes", 4]]],
      ["Combo Ritual 4 Sessões", 143_200, 90, "Ganha 4 finalizações.", [["Ritual de Tratamento", 4]]],
      ["Combo Ritual 8 Sessões", 286_400, 180, "Ganha 8 finalizações. Economia de R$ 960.", [["Ritual de Tratamento", 8]]],
      ["Combo 4 Escovas", 40_000, 90, "Economia de R$ 80.", [["Escova", 4]]],
      ["Duas sessões de manutenção Método Fiaes", 400_000, 90, null, [["Manutenção Método Fiaes", 2]]],
    ] as const;
    for (const [name, price, days, desc, items] of PACKS) {
      const its = await Promise.all(items.map(async ([l, n]) => ({ serviceId: await id(l), sessions: n, unitCents: null })));
      await e2eSql("insert into package_defs (name, price_cents, validity_days, description, items, avec_name) values ($1, $2, $3, $4, $5, 'e2e-shot')", [name, price, days, desc, JSON.stringify(its)]);
    }
    const CLI = [["Marina Alves", "Combo Manutenção Método Fiaes", "Manutenção Método Fiaes", 1, 300], ["Beatriz Costa", "Combo Manutenção Método Fiaes", "Manutenção Método Fiaes", 3, 120],
      ["Juliana Reis", "Combo Ritual 4 Sessões", "Ritual de Tratamento", 2, 40], ["Kelly Salgado", "Combo Ritual 4 Sessões", "Ritual de Tratamento", 3, 12], ["Patrícia Gomes", "Combo 4 Escovas", "Escova", 0, 85]] as const;
    for (const [i, [cli, pk, sv, used, left]] of CLI.entries()) {
      await e2eSql(`insert into client_packages (client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, origin, external_key, package_def_id)
        select $1, $2, $3, 4, $4, d.price_cents, current_date - 20, current_date + $5::int, 'crm', 'e2e:shot:' || $6, d.id from package_defs d where d.name = $2 and d.avec_name = 'e2e-shot'`, [cli, pk, sv, used, left, i]);
    }
    await page.goto("/servicos");
    await shot(page, "servicos-aba-servicos-1366");
    await page.goto("/servicos?aba=pacotes");
    await expect(page.getByRole("article", { name: "Combo Manutenção Método Fiaes" })).toBeVisible();
    await shot(page, "pacotes-1366");
    await page.getByRole("button", { name: "Combo Manutenção Método Fiaes" }).click();
    await shot(page, "pacotes-1366-painel");
    await page.goto("/contatos?vista=pacote");
    await expect(page.getByRole("list", { name: "Pacotes" })).toBeVisible();
    await shot(page, "clientes-com-pacote-1366");
    await login(page, "ana@e2e.local");
    await page.goto("/servicos");
    await shot(page, "servicos-1366-atendente");
  } finally {
    await e2eSql("delete from client_packages where external_key like 'e2e:shot:%'");
    await e2eSql("delete from package_defs where avec_name = 'e2e-shot'");
    await e2eSql("delete from lists where kind = 'service' and position = 900");
    await e2eSql("delete from professionals where name = any($1)", [pros]);
    await e2eSql("update lists set active = true where kind = 'service'");
  }
});

// Bug 16/10: uma compra do Avec em várias linhas (uma por serviço) aparecia como 2–4 pacotes da cliente.
test("Clientes com pacote: compra do Avec em várias linhas é um cartão só, com o uso de cada serviço; filtro Acabando também", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await e2eSql("delete from client_packages where client_name = 'Lia Combo E2e'");
  for (const [k, [svc, used]] of ([["Sessão de pacote metodo", 3], ["Finalização Metodo Fiaes", 1]] as const).entries())
    await e2eSql(`insert into client_packages (client_name, package_name, service_label, total_sessions, used_sessions, price_cents, purchased_on, valid_until, external_key)
      values ('Lia Combo E2e', 'Combo Manutenção Método Fiaes', $1, 4, $2, 800000, current_date - 30, current_date + 300, $3)`, [svc, used, `e2e:combo:${k}`]);
  for (const situacao of ["ativos", "acabando"]) {
    await page.goto(`/contatos?vista=pacote&situacao=${situacao}&q=lia%20combo`);
    const lista = page.getByRole("list", { name: "Pacotes" });
    await expect(lista.locator(":scope > li")).toHaveCount(1);
    await expect(lista.getByRole("list", { name: "Serviços do pacote Combo Manutenção Método Fiaes" }).getByRole("listitem"))
      .toHaveText(["Finalização Método Fiaes1 de 4", "Sessão de Pacote Método3 de 4"]);
    await expect(lista.getByRole("meter", { name: "3 de 4 sessões usadas" })).toBeVisible();
    await expect(lista.getByText(/R\$\s?8\.000/)).toHaveCount(1);
  }
  await e2eSql("delete from client_packages where client_name = 'Lia Combo E2e'");
});
