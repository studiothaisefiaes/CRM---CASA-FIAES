import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { login, simulate, e2eSql, isola } from "./helpers";

/** 17/10: a foto do WhatsApp maior no painel da conversa e na ficha, com zoom ao tocar. */
const PREFIXO = "+5571997171";
const fone = (n: number) => `${PREFIXO}${String(n).padStart(3, "0")}`;

test.beforeEach(async ({ page }) => {
  await login(page);
  await isola(PREFIXO);
});

test("foto do WhatsApp: grande no painel da cliente e na ficha; tocar amplia e Esc, clique fora e Fechar fecham", async ({ page, isMobile }) => {
  test.skip(isMobile, "painel lateral do computador");
  await simulate(page, { phone: "71 99717-1004", name: "Paula Fotografada", text: "Oi!" });
  const [c] = (await e2eSql("select id from contacts where phone_e164 = $1", [fone(4)])) as { id: string }[];
  // Foto de perfil de teste (PNG 1x1) na pasta de mídia do servidor de e2e (data/media, fora do git).
  const rel = `avatars/e2e-${c.id}.png`;
  mkdirSync(path.join("data", "media", "avatars"), { recursive: true });
  writeFileSync(path.join("data", "media", rel), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await e2eSql("update contacts set avatar_path = $2 where id = $1", [c.id, rel]);
  const [{ id }] = await e2eSql("select id from deals where contact_id = $1 and archived_at is null", [c.id]);
  await page.goto(`/atendimento/${id}`);
  const painel = page.getByRole("region", { name: "Dados do cliente" });
  await painel.getByRole("tab", { name: "Cliente" }).click();
  const foto = painel.getByRole("button", { name: "Ver a foto de Paula Fotografada" });
  expect((await foto.boundingBox())!.width).toBeGreaterThanOrEqual(88);
  await foto.click();
  const zoom = page.getByRole("dialog", { name: "Foto de Paula Fotografada" });
  await expect(zoom).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(zoom).toHaveCount(0);
  await foto.click();
  await page.mouse.click(10, 10); // fora da foto
  await expect(zoom).toHaveCount(0);
  await foto.click();
  await page.getByRole("button", { name: "Fechar a foto" }).click();
  await expect(zoom).toHaveCount(0);

  await page.goto(`/contatos/${c.id}`);
  const ficha = page.getByRole("button", { name: "Ver a foto de Paula Fotografada" });
  expect((await ficha.boundingBox())!.width).toBeGreaterThanOrEqual(80);
  await ficha.click();
  await expect(page.getByRole("dialog", { name: "Foto de Paula Fotografada" })).toBeVisible();
});

