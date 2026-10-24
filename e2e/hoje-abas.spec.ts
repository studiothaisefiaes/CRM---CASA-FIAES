import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/** Hoje: a barra de abas (Recepção · Resumo · Ao vivo) fica no mesmo lugar nas três visões. */
test("Hoje: a barra de abas não muda de lugar entre Resumo, Recepção e Ao vivo", async ({ page }) => {
  await login(page);
  const caixa = async () => {
    const nav = page.getByRole("navigation", { name: "Hoje" });
    await expect(nav).toBeVisible();
    const b = (await nav.boundingBox())!;
    const link = (await nav.getByRole("link", { name: "Resumo" }).boundingBox())!;
    return { y: Math.round(b.y), h: Math.round(b.height), x: Math.round(link.x), cls: await nav.getAttribute("class") };
  };
  await page.goto("/?vista=resumo");
  const resumo = await caixa();
  await page.goto("/");
  const recepcao = await caixa();
  await page.goto("/ao-vivo");
  const aoVivo = await caixa();
  expect(recepcao).toEqual(resumo);
  expect(aoVivo).toEqual(resumo);
});
