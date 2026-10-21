import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { setupAgenda, setSetting } from "../../../test/agenda-fixtures";
import { permsFor } from "../../../test/perms";
import { buildComandaCatalog, getComandaCatalog } from "./comanda-catalog";
import { saveClientAlertConfig } from "../domain/client-alert";
import { saveFuncoes } from "../domain/funcoes";
import { addStockMovement, saveProduct } from "../domain/estoque/produtos";

beforeEach(async () => { await resetDb(); });

it("o catálogo da comanda (Receber/Abrir no Hoje): só com o caixa no CRM e para quem opera o caixa", async () => {
  const s = await setupAgenda();
  const gestora = { id: s.gestora.id, perms: permsFor("gestor") };
  await setSetting("caixa_modo", "avec");
  expect(await getComandaCatalog(gestora)).toBeNull();
  await setSetting("caixa_modo", "crm");
  expect(await getComandaCatalog({ id: s.cati.id, perms: [] })).toBeNull();
  const cat = await getComandaCatalog(gestora);
  expect(cat!.services.map((x) => x.label)).toContain("Corte");
  expect(cat!.professionals.map((p) => p.name)).toContain("Ana");
  expect(cat!.canGerir).toBe(true);
  expect(cat!.canAssistente).toBe(true);
  expect(cat!.professionals.find((p) => p.name === "Ana")).toHaveProperty("assistantOf", null);
});

it("item 20: o catálogo diz se o aviso salta na comanda e com que texto (configuração e função)", async () => {
  const s = await setupAgenda();
  await setSetting("caixa_modo", "crm");
  const gestora = { id: s.gestora.id, perms: permsFor("gestor") };
  expect((await getComandaCatalog(gestora))!.clientAlert).toEqual({ on: true, text: "Não autorizou uso de imagem" });
  await saveClientAlertConfig({ naComanda: false, textoSemUsoImagem: "Sem foto" }, s.gestora.id);
  expect((await getComandaCatalog(gestora))!.clientAlert).toEqual({ on: false, text: "Sem foto" });
  await saveClientAlertConfig({ naComanda: true }, s.gestora.id);
  await saveFuncoes({ aviso_salta: false }, s.gestora.id);
  expect((await getComandaCatalog(gestora))!.clientAlert).toEqual({ on: false, text: "Sem foto" });
});

it("item 20: o montador único (Caixa, Ao vivo, Fechar o dia) devolve clientAlert conforme a configuração e leva o extra da página", async () => {
  const s = await setupAgenda();
  const gestora = { perms: permsFor("gestor") };
  expect((await buildComandaCatalog(gestora)).clientAlert).toEqual({ on: true, text: "Não autorizou uso de imagem" });
  await saveClientAlertConfig({ naComanda: false, textoSemUsoImagem: "Sem foto" }, s.gestora.id);
  const c = await buildComandaCatalog(gestora, { today: "2026-10-15", paymentOptions: [{ id: "p", label: "Pix" }] });
  expect(c).toMatchObject({ clientAlert: { on: false, text: "Sem foto" }, today: "2026-10-15", paymentOptions: [{ id: "p", label: "Pix" }], canGerir: true });
});
it("item 20: nenhuma página monta o ComandaCatalog à mão (todas usam o montador, que leva o Aviso da cliente)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["caixa/page.tsx", "ao-vivo/page.tsx", "caixa/fechar-dia/page.tsx"]) {
    const src = readFileSync(`src/app/(app)/${f}`, "utf8");
    expect(src, f).toContain("buildComandaCatalog");
    expect(src, f).not.toContain("packageDefs:");
  }
});

it("devolve os produtos ativos de venda com o estoque, e diz se Produtos e estoque está ligado", async () => {
  const s = await setupAgenda();
  const gestora = { id: s.gestora.id, perms: permsFor("gestor") };
  await setSetting("caixa_modo", "crm");
  const actor = { id: s.gestora.id, perms: permsFor("gestor") };
  const { id } = await saveProduct({ name: "Shampoo", priceCents: 5000, barcode: "789" }, actor);
  await saveProduct({ name: "Antigo", priceCents: 100, active: false }, actor);
  await saveProduct({ name: "Luva", priceCents: 100, use: "consumo" }, actor);
  await addStockMovement({ productId: id, kind: "entrada", qty: 3 }, actor);
  const on = await getComandaCatalog(gestora);
  expect(on!.estoqueLigado).toBe(true);
  expect(on!.products).toEqual([{ id, name: "Shampoo", priceCents: 5000, barcode: "789", stockQty: 3 }]);
  await setSetting("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" });
  const off = await getComandaCatalog(gestora);
  expect(off!.estoqueLigado).toBe(false);
  expect(off!.products).toEqual([]);
});
