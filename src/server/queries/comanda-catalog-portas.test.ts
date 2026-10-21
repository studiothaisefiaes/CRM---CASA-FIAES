import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { setupAgenda, setSetting } from "../../../test/agenda-fixtures";
import { permsFor } from "../../../test/perms";
import { buildComandaCatalog } from "./comanda-catalog";
import { saveProduct } from "../domain/estoque/produtos";

beforeEach(async () => { await resetDb(); });

it("o construtor compartilhado traz os produtos e estoqueLigado (e aceita extras da Caixa)", async () => {
  const s = await setupAgenda();
  const actor = { id: s.gestora.id, perms: permsFor("gestor") };
  await setSetting("caixa_modo", "crm");
  const { id } = await saveProduct({ name: "Shampoo", priceCents: 5000 }, actor);
  const cat = await buildComandaCatalog(actor, { today: "2026-10-18", paymentOptions: [{ id: "x", label: "Pix" }] });
  expect(cat.estoqueLigado).toBe(true);
  expect(cat.products!.map((p) => p.id)).toEqual([id]);
  expect(cat.today).toBe("2026-10-18");
  expect(cat.paymentOptions).toEqual([{ id: "x", label: "Pix" }]);
});

// Cada porta que abre a comanda monta o catálogo pelo construtor compartilhado (sem montar à mão: o Produto cairia em texto livre).
it.each([
  "src/app/(app)/caixa/page.tsx", "src/app/(app)/agenda/page.tsx", "src/app/(app)/ao-vivo/page.tsx", "src/app/(app)/caixa/fechar-dia/page.tsx", "src/app/(app)/page.tsx",
])("%s usa o catálogo compartilhado da comanda", (f) => {
  const src = readFileSync(f, "utf8");
  expect(src).toMatch(/buildComandaCatalog|getComandaCatalog/);
  expect(src).not.toMatch(/packageDefs:\s*(defs|\(await listPackageDefs)/);
});
