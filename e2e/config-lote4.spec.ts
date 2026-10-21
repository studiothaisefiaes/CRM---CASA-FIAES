import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const ANA = "ana@e2e.local";

test("atendente configura o dia a dia, mas não vê nem abre WhatsApp, etapas, mensagens e automações", async ({ page }) => {
  await login(page, ANA);
  await page.goto("/config");
  await expect(page).toHaveURL(/\/config$/); // F5: Configurações abre no índice, não numa aba
  const nav = page.getByRole("navigation", { name: "Grupos de configuração" });
  for (const n of ["Pessoas", "Conversas", "Agenda e caixa"]) await expect(nav.getByRole("link", { name: new RegExp(`^${n}`) })).toBeVisible();
  for (const n of ["A Casa", "Mensagens automáticas", "Trazer dados", "Área de cuidado"]) await expect(nav.getByRole("link", { name: new RegExp(`^${n}`) })).toHaveCount(0);
  await nav.getByRole("link", { name: /^Conversas/ }).click();
  await expect(page).toHaveURL(/\/config\?grupo=conversas$/);
  const lista = page.getByRole("region", { name: "Conversas" });
  for (const n of ["Respostas prontas", "Etiquetas", "Palavras que viram etiqueta", "Motivos de perda", "Objeções", "De onde a cliente veio"]) await expect(lista.getByRole("link", { name: new RegExp(`^${n}`) })).toBeVisible();
  await expect(lista.getByRole("link", { name: /^Etapas e prazos/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Procurar configuração" }).fill("whatsapp");
  await expect(page.getByText("Nada com “whatsapp”.")).toBeVisible();
  for (const path of ["/config/whatsapp", "/config/etapas", "/config/automacoes", "/config/mensagens", "/config/massa", "/config/menu", "/config/chatguru", "/config/avec"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/\?aviso=sem-permissao/);
  }
  await page.goto("/config/distribuicao");
  await expect(page.getByRole("heading", { name: "Pessoas", level: 1 })).toBeVisible(); // Pessoas: a parte que ela pode abrir
  await expect(page.getByRole("switch", { name: "Distribuição automática" })).toBeDisabled();
  await expect(page.getByText("Ligar, desligar e o limite ficam com a gestão")).toBeVisible();
});

test("gestão cria uma etapa, ela aparece no Quadro; apagar sem histórico tira de vez", async ({ page }) => {
  await login(page);
  await page.goto("/config/etapas?parte=etapas");
  await expect(page.getByRole("heading", { name: "Etapas e prazos", level: 1 })).toBeVisible();
  const form = page.getByRole("form", { name: "Nova etapa" });
  await form.getByLabel("Nome").fill("Avaliação marcada");
  await form.getByLabel("Tipo").selectOption({ label: "Agendado" });
  await form.getByRole("button", { name: "Criar etapa" }).click();
  await expect(page.getByText('Etapa "Avaliação marcada" criada')).toBeVisible();
  await page.goto("/funil");
  await expect(page.getByText("Avaliação marcada", { exact: true }).first()).toBeVisible();
  await page.goto("/config/etapas?parte=etapas");
  // Toque antes da hidratação (dev server compilando a rota) não abre a confirmação: tenta de novo até abrir.
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible())) await page.getByRole("button", { name: "Apagar a etapa Avaliação marcada" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByText('"Avaliação marcada" apagada')).toBeVisible();
});

test("Origens numa lista só: o link antigo de Listas leva para Origens e links", async ({ page }) => {
  await login(page);
  await page.goto("/config/listas?aba=origin");
  await expect(page).toHaveURL(/\/config\/origens$/);
  await expect(page.getByRole("heading", { name: "Origens", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Links e QR" })).toBeVisible();
  await page.goto("/config/listas");
  await expect(page.getByRole("tab", { name: "Origens" })).toHaveCount(0);
});
