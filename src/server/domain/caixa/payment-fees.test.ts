import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaPayments, paymentFees } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { getComandaDetail } from "../../queries/caixa";
import { addItem, addPayment, openWalkInComanda } from "./comandas";
import { feeBpTx, listPaymentFees, savePaymentFee } from "./payment-fees";
import { saveCaixaRecursos, getCaixaRecursos } from "./recursos";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });
const pays = () => db.select().from(comandaPayments).orderBy(comandaPayments.createdAt);

describe("taxa do cartão", () => {
  it("crédito à vista, parcelado e débito gravam a taxa do momento; mudar a taxa depois não mexe", async () => {
    await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao);
    await savePaymentFee({ method: "credito", brand: "visa", parcelado: true, feeBp: 570 }, s.caixaGestao);
    const c = await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 30000 }], pays: [
      { method: "credito", valueCents: 10000, brand: "visa", installments: 1 },
      { method: "credito", valueCents: 10000, brand: "visa", installments: 3 },
      { method: "debito", valueCents: 10000, brand: "alelo" },
    ] });
    expect((await pays()).map((x) => [x.method, x.feeBp, x.feeCents])).toEqual([["credito", 243, 243], ["credito", 570, 570], ["debito", null, null]]);
    await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 300 }, s.caixaGestao);
    const d = (await getComandaDetail(c.comandaId, s.cati.id))!;
    expect([d.feeCents, d.netCents, d.missingFeeBrands]).toEqual([813, 29187, ["Alelo"]]);
  });

  it("pix, dinheiro e cortesia não têm taxa; débito parcelado é recusado; taxa auditada; null apaga", async () => {
    await savePaymentFee({ method: "debito", brand: "elo", parcelado: false, feeBp: 199 }, s.caixaGestao);
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 2000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "dinheiro", valueCents: 2000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "cortesia", valueCents: 2000, note: "x" }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "debito", valueCents: 4000, brand: "elo" }, s.caixaRecepcao, NOW);
    expect((await pays()).map((x) => [x.method, x.feeBp, x.feeCents])).toEqual([["pix", null, null], ["dinheiro", null, null], ["cortesia", null, null], ["debito", 199, 80]]);
    await expect(savePaymentFee({ method: "debito", brand: "visa", parcelado: true, feeBp: 199 }, s.caixaGestao)).rejects.toThrow("Débito não tem parcelado.");
    await expect(savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 10001 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "taxa_cartao"))).toHaveLength(1);
    await savePaymentFee({ method: "debito", brand: "elo", parcelado: false, feeBp: null }, s.caixaGestao);
    expect(await listPaymentFees()).toHaveLength(0);
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "taxa_cartao"));
    expect(logs).toHaveLength(2);
    expect(logs[1].data).toMatchObject({ de: 199, para: null });
  });

  it("parcelado = mais de 1 parcela; sem taxa cadastrada devolve null", async () => {
    await savePaymentFee({ method: "credito", brand: "elo", parcelado: true, feeBp: 570 }, s.caixaGestao);
    expect(await feeBpTx(db, { method: "credito", brand: "elo", installments: 2 })).toBe(570);
    expect(await feeBpTx(db, { method: "credito", brand: "elo", installments: 1 })).toBeNull();
    expect(await feeBpTx(db, { method: "pix", brand: null, installments: null })).toBeNull();
  });

  it("liga/desliga: desligada, o pagamento entra sem taxa e a comanda não mostra taxa; religada, grava", async () => {
    await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao);
    const r = await getCaixaRecursos();
    await saveCaixaRecursos({ ...r, taxaCartao: false }, s.gestora.id);
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "credito", valueCents: 4000, brand: "visa", installments: 1 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "debito", valueCents: 1000, brand: "alelo" }, s.caixaRecepcao, NOW);
    expect((await pays()).map((x) => [x.feeBp, x.feeCents])).toEqual([[null, null], [null, null]]);
    const off = (await getComandaDetail(w.comandaId, s.cati.id))!;
    expect([off.feeCents, off.netCents, off.missingFeeBrands]).toEqual([0, 10000, []]);
    await saveCaixaRecursos({ ...r, taxaCartao: true }, s.gestora.id);
    await addPayment(w.comandaId, { method: "credito", valueCents: 5000, brand: "visa", installments: 1 }, s.caixaRecepcao, NOW);
    expect((await pays()).map((x) => [x.feeBp, x.feeCents])).toEqual([[null, null], [null, null], [243, 122]]);
    expect(await db.select().from(paymentFees)).toHaveLength(1);
  });
});
