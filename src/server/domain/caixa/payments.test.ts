import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaPayments, comandas } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { money } from "@/lib/format";
import { cashSummary, closeCash, openCash } from "./cash";
import { addItem, addPayment, CashClosedError, closeComanda, discardComanda, openWalkInComanda, removePayment } from "./comandas";
import { listPaymentOptions, savePaymentOption } from "./payment-options";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

/** Comanda avulsa com um produto de R$ 120,00. */
async function comanda120() {
  const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 12000 }, s.caixaRecepcao, NOW);
  return w.comandaId;
}
const pays = (comandaId: string) => db.select().from(comandaPayments).where(eq(comandaPayments.comandaId, comandaId)).orderBy(comandaPayments.createdAt);

describe("formas de pagamento", () => {
  it("crédito pede bandeira e parcelas de 1 a 12; débito pede bandeira; a bandeira fica gravada", async () => {
    const c = await comanda120();
    await expect(addPayment(c, { method: "credito", valueCents: 5000, installments: 3 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a bandeira do cartão.");
    await expect(addPayment(c, { method: "debito", valueCents: 5000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a bandeira do cartão.");
    await expect(addPayment(c, { method: "credito", valueCents: 5000, brand: "visa", installments: 13 }, s.caixaRecepcao, NOW)).rejects.toThrow("Parcelas de 1 a 12.");
    await addPayment(c, { method: "credito", valueCents: 5000, brand: "elo", installments: 3, note: "maquininha 2" }, s.caixaRecepcao, NOW);
    await addPayment(c, { method: "debito", valueCents: 1000, brand: "alelo" }, s.caixaRecepcao, NOW);
    expect((await pays(c)).map((p) => [p.method, p.brand, p.installments, p.note])).toEqual([["credito", "elo", 3, "maquininha 2"], ["debito", "alelo", null, null]]);
  });

  it("forma que não é dinheiro não passa do restante; dinheiro passa e o troco fica no pagamento em dinheiro", async () => {
    const c = await comanda120();
    await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await expect(addPayment(c, { method: "pix", valueCents: 8000 }, s.caixaRecepcao, NOW)).rejects.toThrow(`Passa do que falta (${money(7000)}). Só o dinheiro pode passar e virar troco.`);
    await addPayment(c, { method: "dinheiro", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await expect(addPayment(c, { method: "dinheiro", valueCents: 100 }, s.caixaRecepcao, NOW)).rejects.toThrow("Essa comanda já está paga.");
    expect(await closeComanda(c, {}, s.caixaRecepcao, NOW)).toMatchObject({ totalCents: 12000, changeCents: 3000 });
    expect((await pays(c)).map((p) => [p.method, p.changeCents])).toEqual([["pix", 0], ["dinheiro", 3000]]);
  });

  it("pagamento parcial deixa a comanda aberta com saldo", async () => {
    const c = await comanda120();
    await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    const [row] = await db.select().from(comandas).where(eq(comandas.id, c));
    expect(row.status).toBe("aberta");
    await expect(closeComanda(c, {}, s.caixaRecepcao, NOW)).rejects.toThrow(`Faltam ${money(7000)} para fechar.`);
  });

  it("o pagamento grava o caixa de quem recebeu (sem caixa aberto, fica sem caixa)", async () => {
    const a = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda120();
    await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await addPayment(c, { method: "pix", valueCents: 1000 }, s.caixaGestao, NOW);
    expect((await pays(c)).map((p) => p.cashSessionId)).toEqual([a.id, null]);
  });

  it("'exigir caixa aberto' vale no receber", async () => {
    await setSetting("caixa_regras", { exigeCaixaAberto: true });
    const c = await comanda120();
    const err = await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(CashClosedError);
    expect(err.message).toBe("Abra o seu caixa para receber.");
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
  });

  it("cortesia pede motivo e vai para a auditoria", async () => {
    const c = await comanda120();
    await expect(addPayment(c, { method: "cortesia", valueCents: 2000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo da cortesia.");
    await addPayment(c, { method: "cortesia", valueCents: 2000, note: "aniversário" }, s.caixaRecepcao, NOW);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "cortesia"));
    expect(log).toMatchObject({ userId: s.cati.id, entity: "comanda", entityId: c, data: { numero: 1, valor: 2000, motivo: "aniversário" } });
  });

  it("Outra forma pede uma forma ativa cadastrada", async () => {
    const { id } = await savePaymentOption({ label: "Transferência" }, s.caixaGestao);
    const c = await comanda120();
    await expect(addPayment(c, { method: "outra", valueCents: 2000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha qual é a outra forma.");
    await addPayment(c, { method: "outra", valueCents: 2000, customMethodId: id }, s.caixaRecepcao, NOW);
    await savePaymentOption({ id, label: "Transferência", active: false }, s.caixaGestao);
    await expect(addPayment(c, { method: "outra", valueCents: 2000, customMethodId: id }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha qual é a outra forma.");
  });

  it("dois Pix que juntos passam do total: o segundo é recusado", async () => {
    const c = await comanda120();
    const r = await Promise.allSettled([
      addPayment(c, { method: "pix", valueCents: 8000 }, s.caixaRecepcao, NOW),
      addPayment(c, { method: "pix", valueCents: 8000 }, s.caixaGestao, NOW),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toBe(`Passa do que falta (${money(4000)}). Só o dinheiro pode passar e virar troco.`);
  });

  it("troco de dinheiro parcial + Pix de outra pessoa fica no caixa de quem recebeu o dinheiro", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    const b = await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
    const c = await comanda120();
    await addPayment(c, { method: "dinheiro", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(c, { method: "pix", valueCents: 2000 }, s.caixaGestao, NOW);
    // Antes de fechar, nada de troco (a conta ainda pode mudar).
    expect((await cashSummary(a.id)).expected.dinheiro).toBe(20000);
    // A gestora corrige o preço para R$ 90 e fecha: o dinheiro precisava cobrir 70; troco 30 no pagamento da Cati.
    await db.execute(`update comanda_items set unit_cents = 9000 where comanda_id = '${c}'`);
    expect(await closeComanda(c, {}, s.caixaGestao, NOW)).toMatchObject({ totalCents: 9000, changeCents: 3000 });
    expect((await cashSummary(a.id)).expected.dinheiro).toBe(17000);
    expect((await cashSummary(b.id)).expected).toMatchObject({ dinheiro: 0, pix: 2000 });
  });
});

describe("descartar", () => {
  it("comanda com pagamento não se descarta (o dinheiro sumiria do caixa): estorne antes", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda120();
    const p = await addPayment(c, { method: "dinheiro", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await expect(discardComanda(c, s.caixaRecepcao, NOW)).rejects.toThrow("Essa comanda já recebeu pagamento: estorne antes de descartar.");
    await removePayment(p.id, {}, s.caixaRecepcao, NOW);
    await discardComanda(c, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, c)))[0].status).toBe("cancelada");
  });
});

describe("estorno", () => {
  it("tira o pagamento com motivo e audita; recusa pagamento de caixa já fechado", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda120();
    const p1 = await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await removePayment(p1.id, { reason: "pix não caiu" }, s.caixaRecepcao, NOW);
    const [p] = await db.select().from(comandaPayments).where(eq(comandaPayments.id, p1.id));
    expect(p).toMatchObject({ cancelledBy: s.cati.id, cancelReason: "pix não caiu" });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "estorno")))[0].data).toMatchObject({ numero: 1, forma: "pix", valor: 5000, motivo: "pix não caiu" });
    const p2 = await addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await closeCash({ cashBreakdown: {}, counted: { pix: 5000 } }, s.caixaRecepcao, NOW);
    await expect(removePayment(p2.id, {}, s.caixaGestao, NOW)).rejects.toThrow("Esse pagamento entrou no caixa de Cati, que já fechou.");
    expect(await db.select().from(comandaPayments).where(and(eq(comandaPayments.id, p2.id)))).toMatchObject([{ cancelledAt: null }]);
  });
});

describe("Outra forma (cadastro da gestão)", () => {
  it("cadastra, recusa nome repetido, renomeia e desativa; a lista ativa só mostra as ativas", async () => {
    const { id } = await savePaymentOption({ label: " Transferência " }, s.caixaGestao);
    await expect(savePaymentOption({ label: "transferência" }, s.caixaGestao)).rejects.toThrow("Já existe a forma transferência.");
    await expect(savePaymentOption({ label: "x" }, s.caixaGestao)).rejects.toThrow("Escreva o nome da forma (2 a 40 letras).");
    await savePaymentOption({ label: "Vale da Casa" }, s.caixaGestao);
    await savePaymentOption({ id, label: "TED", active: false }, s.caixaGestao);
    expect((await listPaymentOptions()).map((o) => [o.label, o.active])).toEqual([["TED", false], ["Vale da Casa", true]]);
    expect((await listPaymentOptions({ activeOnly: true })).map((o) => o.label)).toEqual(["Vale da Casa"]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "forma_pagamento_salva"))).toHaveLength(3);
  });
});
