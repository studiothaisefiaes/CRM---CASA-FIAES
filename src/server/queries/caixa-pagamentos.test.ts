import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { bahia, NOW } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { addMovement, closeCash, openCash } from "../domain/caixa/cash";
import { addItem, addPayment, cancelComanda, closeComanda, openWalkInComanda, removeItem, removePayment, reopenComanda, setComandaDiscount, updateItem } from "../domain/caixa/comandas";
import { savePaymentOption } from "../domain/caixa/payment-options";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { comandaPayments } from "../db/schema";
import { listCaixaExceptions, paymentsByDay, paymentsByMethod, paymentsBySession } from "./caixa-pagamentos";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

async function comanda(cents: number, now = NOW, clientName = "Paula") {
  const w = await openWalkInComanda({ requestKey: randomUUID(), clientName }, s.caixaRecepcao, now);
  const { id } = await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: cents }, s.caixaRecepcao, now);
  return { id: w.comandaId, itemId: id };
}
const dia15 = { from: "2026-10-15", to: "2026-10-15" };

describe("leituras para o Financeiro", () => {
  it("por forma, por caixa (com 'sem caixa') e por dia; dinheiro líquido do troco; estorno e comanda cancelada ficam fora", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    const { id: transf } = await savePaymentOption({ label: "Transferência" }, s.caixaGestao);
    const c1 = await comanda(12000);
    await addPayment(c1.id, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await addPayment(c1.id, { method: "dinheiro", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await closeComanda(c1.id, {}, s.caixaRecepcao, NOW); // troco 3.000
    const c2 = await comanda(10000); // parcial, aberta
    await addPayment(c2.id, { method: "credito", valueCents: 2000, brand: "visa" }, s.caixaGestao, NOW);
    await addPayment(c2.id, { method: "outra", valueCents: 1000, customMethodId: transf }, s.caixaGestao, NOW);
    const p = await addPayment(c2.id, { method: "pix", valueCents: 999 }, s.caixaGestao, NOW);
    await removePayment(p.id, { reason: "errado" }, s.caixaGestao, NOW);
    const c3 = await comanda(4000);
    await addPayment(c3.id, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
    await closeComanda(c3.id, {}, s.caixaRecepcao, NOW);
    await cancelComanda(c3.id, { reason: "cliente errada" }, s.caixaGestao, NOW);
    const c4 = await comanda(1000);
    await addPayment(c4.id, { method: "cortesia", valueCents: 1000, note: "aniversário" }, s.caixaRecepcao, NOW);
    const c5 = await comanda(700, bahia(14, 15));
    await addPayment(c5.id, { method: "pix", valueCents: 700 }, s.caixaGestao, bahia(14, 15));

    expect(await paymentsByMethod(dia15)).toEqual([
      { method: "pix", label: "Pix", customMethodId: null, valueCents: 5000, feeCents: 0, count: 1 },
      { method: "credito", label: "Crédito", customMethodId: null, valueCents: 2000, feeCents: 0, count: 1 },
      { method: "dinheiro", label: "Dinheiro", customMethodId: null, valueCents: 7000, feeCents: 0, count: 1 },
      { method: "cortesia", label: "Cortesia", customMethodId: null, valueCents: 1000, feeCents: 0, count: 1 },
      { method: "outra", label: "Transferência", customMethodId: transf, valueCents: 1000, feeCents: 0, count: 1 },
    ]);
    const days = await paymentsByDay({ from: "2026-10-14", to: "2026-10-15" });
    expect(days.map((d) => [d.day, d.moneyCents, d.count, d.byMethod.pix, d.byMethod.cortesia])).toEqual([["2026-10-14", 700, 1, 700, 0], ["2026-10-15", 15000, 5, 5000, 1000]]);
    const sessions = await paymentsBySession(dia15);
    expect(sessions.map((x) => [x.sessionId, x.personName, x.status, x.moneyCents, x.byMethod.dinheiro, x.byMethod.cortesia, x.byMethod.outra])).toEqual([
      [a.id, "Cati", "aberto", 12000, 7000, 1000, 0],
      [null, "Sem caixa", "sem_caixa", 3000, 0, 0, 1000],
    ]);
  });

  it("taxa do cartão por forma: soma o fee_cents gravado; Pix sem taxa; estornado não soma", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda(30000);
    const p1 = await addPayment(c.id, { method: "credito", valueCents: 10000, brand: "visa" }, s.caixaRecepcao, NOW);
    const p2 = await addPayment(c.id, { method: "credito", valueCents: 10000, brand: "visa" }, s.caixaRecepcao, NOW);
    const p3 = await addPayment(c.id, { method: "credito", valueCents: 5000, brand: "visa" }, s.caixaRecepcao, NOW);
    await addPayment(c.id, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await db.update(comandaPayments).set({ feeCents: 243 }).where(eq(comandaPayments.id, p1.id));
    await db.update(comandaPayments).set({ feeCents: 570 }).where(eq(comandaPayments.id, p2.id));
    await db.update(comandaPayments).set({ feeCents: 99 }).where(eq(comandaPayments.id, p3.id));
    await removePayment(p3.id, { reason: "errado" }, s.caixaRecepcao, NOW);
    const m = await paymentsByMethod(dia15);
    expect(m.find((x) => x.method === "credito")).toMatchObject({ valueCents: 20000, feeCents: 813 });
    expect(m.find((x) => x.method === "pix")).toMatchObject({ feeCents: 0 });
  });

  it("exceções: preço, desconto, cortesia, item cancelado, estorno, reabertura e sangria grande, com quem fez e o motivo", async () => {
    let k = 0;
    const t = () => bahia(15, 9, ++k); // um minuto por passo: a ordem da lista é a do tempo
    await openCash({ openingCents: 50000 }, s.caixaRecepcao, t());
    const c = await comanda(12000, t());
    await updateItem(c.itemId, { unitCents: 10000, reason: "cliente antiga" }, s.caixaRecepcao, t());
    await setComandaDiscount(c.id, { cents: 1000, reason: "à vista" }, s.caixaRecepcao, t());
    const extra = await addItem(c.id, { kind: "produto", label: "Brinde", unitCents: 500 }, s.caixaRecepcao, t());
    await removeItem(extra.id, { reason: "não quis" }, s.caixaRecepcao, t());
    await addPayment(c.id, { method: "cortesia", valueCents: 9000, note: "aniversário" }, s.caixaGestao, t());
    await closeComanda(c.id, {}, s.caixaRecepcao, t());
    await reopenComanda(c.id, { reason: "conferir" }, s.caixaRecepcao, t());
    await addMovement({ kind: "sangria", valueCents: 30000, reason: "banco" }, s.caixaRecepcao, t());
    await closeCash({ cashBreakdown: {}, counted: {} }, s.caixaRecepcao, t()); // 200 esperados, nada contado: pede aprovação e fica registrado
    const ex = await listCaixaExceptions(dia15);
    expect(ex.map((e) => [e.kind, e.userName, e.comandaNumber, e.item, e.valueCents, e.previousCents, e.reason])).toEqual([
      ["preco_alterado", "Cati", 1, "Kit", 10000, 12000, "cliente antiga"],
      ["desconto", "Cati", 1, null, 1000, null, "à vista"],
      ["item_cancelado", "Cati", 1, "Brinde", 500, null, "não quis"],
      ["cortesia", "Thaíse Fiaes", 1, null, 9000, null, "aniversário"],
      ["comanda_reaberta", "Cati", 1, null, 9000, null, "conferir"],
      ["sangria_grande", "Cati", null, null, 30000, null, "banco"],
      ["contagem_recusada", "Cati", null, null, -20000, null, null],
    ]);
    expect(await listCaixaExceptions({ from: "2026-10-16", to: "2026-10-16" })).toEqual([]);
  });
});
