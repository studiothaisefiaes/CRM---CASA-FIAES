import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../../test/db";
import { bahia, cliente } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { DRAWER_METHODS } from "@/lib/comanda-math";
import { openCash } from "../../domain/caixa/cash";
import { addItem, addPayment, closeComanda, openWalkInComanda, type AddPaymentInput } from "../../domain/caixa/comandas";
import { getCaixaHoje } from "../../queries/caixa";
import { financeEntradas } from "./entradas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

/** Uma comanda avulsa com um produto, recebida nas formas dadas; fechada quando `fechar`. */
async function venda(cents: number, pays: AddPaymentInput[], o: { fechar?: boolean; contactId?: string; guardarTroco?: boolean; h?: number } = {}) {
  const at = bahia(15, o.h ?? 10);
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: o.contactId ?? null }, s.caixaRecepcao, at);
  await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: cents }, s.caixaRecepcao, at);
  for (const p of pays) await addPayment(w.comandaId, p, s.caixaRecepcao, at);
  if (o.fechar !== false) await closeComanda(w.comandaId, { saveChangeAsCredit: !!o.guardarTroco }, s.caixaRecepcao, at);
  return w.comandaId;
}

/**
 * QA r58, C-2: o "entrou hoje" do Caixa e as Entradas do Financeiro, no mesmo cenário, batem forma por forma. Inclui o pagamento parcial
 * de comanda ainda aberta (já está na gaveta), a cortesia (fora dos dois) e o crédito da cliente (não é dinheiro que entrou: o troco
 * guardado já entrou como dinheiro).
 */
it("Caixa e Financeiro batem: o parcial de comanda aberta conta pela data do pagamento; cortesia e crédito da cliente ficam fora dos dois", async () => {
  await openCash({ openingCents: 10000 }, s.caixaRecepcao, bahia(15, 8));
  await venda(15000, [{ method: "pix", valueCents: 5000 }, { method: "dinheiro", valueCents: 7000 }, { method: "debito", valueCents: 3000, brand: "visa" }]);
  await venda(6000, [{ method: "cortesia", valueCents: 6000, note: "aniversário da cliente" }]);
  await venda(7000, [{ method: "dinheiro", valueCents: 10000 }]); // troco de 30
  await venda(9000, [{ method: "pix", valueCents: 4000 }], { fechar: false }); // parcial: R$ 40 na gaveta, comanda aberta
  const p = await cliente("Paula Souza");
  await venda(2000, [{ method: "dinheiro", valueCents: 5000 }], { contactId: p.contactId, guardarTroco: true }); // 30 viram crédito
  await venda(3000, [{ method: "credito_cliente", valueCents: 3000 }], { contactId: p.contactId, h: 11 });

  const caixa = (await getCaixaHoje(s.caixaGestao, bahia(15, 12))).totals!;
  const fin = await financeEntradas({ from: "2026-10-15", to: "2026-10-15", grain: "dia" });
  expect(caixa.totalCents).toBe(31000); // 150 + 70 (100 − 30 de troco) + 40 + 50
  expect(fin.crm.entradasCents).toBe(caixa.totalCents);
  for (const m of DRAWER_METHODS) expect([m, fin.methods.find((x) => x.key === m)?.crmCents ?? 0]).toEqual([m, caixa.byMethod[m]]);
  expect(fin.days).toEqual([expect.objectContaining({ key: "2026-10-15", crmCents: 31000 })]);
  expect(fin.cashiers).toEqual([expect.objectContaining({ userName: "Cati", entradasCents: 31000, status: "aberto" })]);
});
