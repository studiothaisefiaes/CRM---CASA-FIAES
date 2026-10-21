import { beforeEach, expect, it } from "vitest";
import { db } from "../../db";
import { avecReports, salesItems } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { item } from "../../../../test/salon-fixtures";
import { applyCommissionBackfill, planCommissionBackfill, restoreCommissionBackfill, rowCommission, type CommissionBackup } from "./commission-backfill";

const ITENS = ["Data", "Comanda", "Item", "Tipo", "Categoria", "Profissional", "Assistente 1", "Assistente 2", "Comissão (%)", "Cliente", "Valor", "Desconto", "Qtd.", "Custo", "Comissão", "Líquido", "UA"];
const POR_ITEM = ["Data Comanda", "N° da Comanda", "Serviço ou Produto", "Cliente", "Valor Cobrado", "Comissão (%)", "Total"];
const NOW = new Date("2026-10-15T15:00:00Z");
let seq = 0;
const guardar = (title: string, columns: string[], rows: string[][]) =>
  db.insert(avecReports).values({ signature: `teste${++seq}`, title, fileName: `${title}.xlsx`, fileHash: `h${seq}`, columns, rows, rowCount: rows.length });

beforeEach(resetDb);

it("'Comissão por item': o Total só vale como comissão quando bate com valor × %", () => {
  expect(rowCommission(POR_ITEM, ["01/09/2026", "7", "Corte", "Ana Teste", "150,00", "40", "60,00"])).toEqual({ pct: 40, cents: 6000 });
  expect(rowCommission(POR_ITEM, ["01/09/2026", "7", "Corte", "Ana Teste", "150,00", "40", "150,00"])).toEqual({ pct: 40, cents: null });
});

it("preenche pelos relatórios guardados: 'Itens de comanda' primeiro; o que já tinha comissão não muda; o segundo ensaio vem vazio; desfazer volta", async () => {
  await item({ day: "2026-09-02", comanda: "7", item: "Corte Feminino", value: 15000, proName: "MAIARA TESTE" });
  await item({ day: "2026-09-02", comanda: "8", item: "Escova", value: 8000, proName: "JO TESTE" });
  await item({ day: "2026-09-03", comanda: "9", item: "Mega Hair", value: 380000, proName: "MAIARA TESTE", commissionPct: 30, commissionCents: 114000 });
  await guardar("Itens de comanda", ITENS, [
    ["02/09/2026", "7", "Corte Feminino", "Serviço", "Cabelo", "MAIARA TESTE", "", "", "40", "Ana Teste", "150,00", "0", "1", "0", "60,00", "90,00", ""],
    ["03/09/2026", "9", "Mega Hair", "Serviço", "Cabelo", "MAIARA TESTE", "", "", "35", "Bia Teste", "3.800,00", "0", "1", "0", "1.330,00", "", ""],
  ]);
  await guardar("Comissão por item", POR_ITEM, [
    ["02/09/2026", "7", "Corte Feminino", "Ana Teste", "150,00", "10", "15,00"], // o "Itens de comanda" já decidiu este item
    ["02/09/2026", "8", "Escova", "Caio Teste", "80,00", "50", "40,00"],
    ["05/09/2026", "99", "Item que não existe", "Caio Teste", "10,00", "50", "5,00"],
  ]);
  const plan = await planCommissionBackfill(NOW);
  expect(plan.updates.map((u) => [u.professional, u.commissionPct, u.commissionCents]).sort()).toEqual([["JO TESTE", 50, 4000], ["MAIARA TESTE", 40, 6000]]);
  expect(plan).toMatchObject({ semPar: 1, ambiguas: 0, jaTinham: 1 });
  expect(plan.conferencia.mes).toBe("2026-09");

  let backup: CommissionBackup | null = null;
  expect(await applyCommissionBackfill(plan, async (b) => { backup = b; })).toEqual({ updated: 2 });
  expect(backup!.itens).toHaveLength(2);
  expect((await planCommissionBackfill(NOW)).updates).toEqual([]);
  const mega = (await db.select().from(salesItems)).find((i) => i.item === "Mega Hair")!;
  expect([mega.commissionPct, mega.commissionCents]).toEqual([30, 114000]);

  expect(await restoreCommissionBackfill(backup!)).toBe(2);
  expect((await db.select().from(salesItems)).filter((i) => i.commissionCents != null)).toHaveLength(1);
});

it("mesmo item duas vezes na comanda, comissões diferentes e nada para separar: fica de fora (ambíguo), nunca o valor errado", async () => {
  await item({ day: "2026-09-02", comanda: "7", item: "Escova", value: 8000 });
  await item({ day: "2026-09-02", comanda: "7", item: "Escova", value: 8000 });
  await guardar("Comissão por item", POR_ITEM, [
    ["02/09/2026", "7", "Escova", "Ana Teste", "80,00", "40", "32,00"],
    ["02/09/2026", "7", "Escova", "Ana Teste", "80,00", "50", "40,00"],
  ]);
  const plan = await planCommissionBackfill(NOW);
  expect(plan.updates).toEqual([]);
  expect(plan.ambiguas).toBe(2);
});
