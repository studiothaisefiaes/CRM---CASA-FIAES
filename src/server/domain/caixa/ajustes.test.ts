import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, clientPackages, comandaItems, comandaPayments, comandas, packageDefs, packageUses } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { createVisit } from "../agenda/visits";
import { closeCash, openCash } from "./cash";
import { addCreditTx, creditBalance } from "./credits";
import {
  addItem, addPayment, cancelComanda, closeComanda, openComandaForAppointment, openWalkInComanda, removeItem, reopenComanda, setComandaCpf, setComandaDiscount, updateItem,
} from "./comandas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

/** Comanda da visita de Paula com Corte (R$ 120, Ana). */
async function comCorte() {
  const p = await cliente("Paula Souza");
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, bahia(15, 8));
  const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
  const [item] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId));
  return { p, comandaId: c.comandaId, item };
}
const logs = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.createdAt));
const itemOf = async (id: string) => (await db.select().from(comandaItems).where(eq(comandaItems.id, id)))[0];

describe("preço, desconto e item, sempre com motivo e rastro", () => {
  it("mudar preço pede motivo, guarda o anterior e audita", async () => {
    const { comandaId, item } = await comCorte();
    expect(item).toMatchObject({ unitCents: 12000, originalUnitCents: 12000 });
    await expect(updateItem(item.id, { unitCents: 10000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo da mudança de preço.");
    await updateItem(item.id, { unitCents: 10000, reason: "cliente antiga" }, s.caixaRecepcao, NOW);
    expect(await itemOf(item.id)).toMatchObject({ unitCents: 10000, originalUnitCents: 12000, priceReason: "cliente antiga" });
    const [log] = await logs("preco_alterado");
    expect(log).toMatchObject({ userId: s.cati.id, entity: "comanda", entityId: comandaId, data: { numero: 1, item: "Corte", de: 12000, para: 10000, motivo: "cliente antiga" } });
    await updateItem(item.id, { professionalId: s.bia.id }, s.caixaRecepcao, NOW); // sem mudar preço: sem motivo
    expect(await logs("preco_alterado")).toHaveLength(1);
  });

  it("preencher preço vazio não pede motivo", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    const { id } = await addItem(w.comandaId, { kind: "servico", serviceId: s.mechas.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await updateItem(id, { unitCents: 30000 }, s.caixaRecepcao, NOW);
    expect(await itemOf(id)).toMatchObject({ unitCents: 30000, originalUnitCents: null, priceReason: null });
    expect(await logs("preco_alterado")).toHaveLength(0);
  });

  it("somar serviço com preço diferente do catálogo pede motivo", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await expect(addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 9000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo da mudança de preço.");
    const { id } = await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 9000, reason: "promoção" }, s.caixaRecepcao, NOW);
    expect(await itemOf(id)).toMatchObject({ unitCents: 9000, originalUnitCents: 12000, priceReason: "promoção", fiscalKind: "servico" });
    expect((await logs("preco_alterado"))[0].data).toMatchObject({ de: 12000, para: 9000, motivo: "promoção" });
  });

  it("desconto no item em R$ ou em % pede motivo e audita", async () => {
    const { item } = await comCorte();
    await expect(updateItem(item.id, { discountPercent: 10 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo do desconto.");
    await updateItem(item.id, { discountPercent: 10, reason: "primeira vez" }, s.caixaRecepcao, NOW);
    expect(await itemOf(item.id)).toMatchObject({ discountCents: 1200, discountReason: "primeira vez" });
    await updateItem(item.id, { discountCents: 500, reason: "fidelidade" }, s.caixaRecepcao, NOW);
    expect((await logs("desconto")).map((l) => l.data)).toEqual([
      expect.objectContaining({ item: "Corte", valor: 1200, percentual: 10, motivo: "primeira vez" }),
      expect.objectContaining({ item: "Corte", valor: 500, percentual: null, motivo: "fidelidade" }),
    ]);
    await updateItem(item.id, { discountCents: 0 }, s.caixaRecepcao, NOW); // tirar o desconto não pede motivo
    expect((await itemOf(item.id)).discountCents).toBe(0);
  });

  it("desconto na comanda pede motivo e audita", async () => {
    const { comandaId } = await comCorte();
    await expect(setComandaDiscount(comandaId, { cents: 1000 }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo do desconto.");
    await setComandaDiscount(comandaId, { percent: 5, reason: "pagou à vista" }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0]).toMatchObject({ discountCents: 600, discountReason: "pagou à vista" });
    expect((await logs("desconto"))[0].data).toMatchObject({ item: null, valor: 600, percentual: 5, motivo: "pagou à vista" });
  });

  it("tirar item audita item_cancelado (motivo opcional)", async () => {
    const { comandaId, item } = await comCorte();
    await removeItem(item.id, { reason: "lançado errado" }, s.caixaRecepcao, NOW);
    expect((await logs("item_cancelado"))[0]).toMatchObject({ entityId: comandaId, data: { numero: 1, item: "Corte", valor: 12000, motivo: "lançado errado" } });
  });

  it("produto é produto para a nota; CPF válido grava só os dígitos, inválido recusa", async () => {
    const { comandaId } = await comCorte();
    const { id } = await addItem(comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
    expect((await itemOf(id)).fiscalKind).toBe("produto");
    await expect(setComandaCpf(comandaId, "111.111.111-11", s.caixaRecepcao, NOW)).rejects.toThrow("CPF inválido.");
    await setComandaCpf(comandaId, "529.982.247-25", s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0].cpf).toBe("52998224725");
    await setComandaCpf(comandaId, null, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0].cpf).toBeNull();
  });
});

describe("reabrir e cancelar", () => {
  it("reabrir no lugar: mantém pagamentos, desfaz crédito, sessão de pacote e comissão; fechar de novo não dobra", async () => {
    const { p, comandaId } = await comCorte();
    await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 5000, reason: "troco" }, s.cati.id));
    const [cp] = await db.insert(clientPackages).values({ contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, unitCents: 10000, validUntil: "2027-01-01", externalKey: "t:1" }).returning();
    await addItem(comandaId, { kind: "pacote_sessao", clientPackageId: cp.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await addPayment(comandaId, { method: "credito_cliente", valueCents: 2000 }, s.caixaRecepcao, NOW);
    await addPayment(comandaId, { method: "dinheiro", valueCents: 12000 }, s.caixaRecepcao, NOW);
    await closeComanda(comandaId, {}, s.caixaRecepcao, NOW);
    expect(await creditBalance(p.contactId)).toBe(3000);
    await expect(reopenComanda(comandaId, { reason: " " }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo.");
    await reopenComanda(comandaId, { reason: "esqueceu o shampoo" }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0]).toMatchObject({ status: "aberta", closedAt: null, reopenReason: "esqueceu o shampoo", reopenedBy: s.cati.id });
    expect(await creditBalance(p.contactId)).toBe(5000);
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, cp.id)))[0].usedSessions).toBe(1);
    expect((await db.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, comandaId), isNull(comandaPayments.cancelledAt)))).map((x) => [x.method, x.changeCents]))
      .toEqual([["credito_cliente", 0], ["dinheiro", 0]]);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId))).every((i) => i.commissionCents == null && i.totalCents == null)).toBe(true);
    expect((await logs("comanda_reaberta"))[0].data).toMatchObject({ numero: 1, motivo: "esqueceu o shampoo" });
    await closeComanda(comandaId, {}, s.caixaRecepcao, NOW);
    expect(await creditBalance(p.contactId)).toBe(3000);
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, cp.id)))[0].usedSessions).toBe(2);
    expect(await db.select().from(packageUses).where(and(eq(packageUses.clientPackageId, cp.id), isNull(packageUses.cancelledAt)))).toHaveLength(1);
  });

  it("reabrir comanda de outro dia é da gestão", async () => {
    const [c] = await db.insert(comandas).values({ day: "2026-10-14", number: 1, status: "fechada", openedBy: s.cati.id, closedBy: s.cati.id, closedAt: bahia(14, 18), totalCents: 0 }).returning();
    await expect(reopenComanda(c.id, { reason: "erro" }, s.caixaRecepcao, NOW)).rejects.toThrow("Comanda de outro dia: só a gestão reabre.");
    await reopenComanda(c.id, { reason: "erro" }, s.caixaGestao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, c.id)))[0].status).toBe("aberta");
  });

  it("cancelar fechada estorna os pagamentos; recusa se o caixa de algum já fechou", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const a = await comCorte();
    await addPayment(a.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, NOW);
    await closeComanda(a.comandaId, {}, s.caixaRecepcao, NOW);
    await cancelComanda(a.comandaId, { reason: "cliente errada" }, s.caixaGestao, NOW);
    expect((await db.select().from(comandaPayments).where(eq(comandaPayments.comandaId, a.comandaId)))[0]).toMatchObject({ cancelledBy: s.gestora.id, cancelReason: "cliente errada" });
    expect((await logs("estorno"))[0].data).toMatchObject({ forma: "pix", valor: 12000, motivo: "cliente errada" });
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 5000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    await closeCash({ cashBreakdown: {}, counted: { pix: 5000 } }, s.caixaRecepcao, NOW);
    await expect(cancelComanda(w.comandaId, { reason: "erro" }, s.caixaGestao, NOW)).rejects.toThrow("Esse pagamento entrou no caixa de Cati, que já fechou.");
  });
});

describe("pacote vendido numa comanda reaberta", () => {
  it("reabrir cancela o pacote vendido; fechar de novo o traz de volta (sem duplicar)", async () => {
    const p = await cliente("Paula Souza");
    const [def] = await db.insert(packageDefs).values({ name: "Combo", priceCents: 40000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10000 }] }).returning();
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "pacote_venda", packageDefId: def.id }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 40000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    await reopenComanda(w.comandaId, { reason: "trocar a forma" }, s.caixaRecepcao, NOW);
    expect((await db.select().from(clientPackages).where(eq(clientPackages.origin, "crm")))[0].cancelledAt).not.toBeNull();
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    const pk = await db.select().from(clientPackages).where(eq(clientPackages.origin, "crm"));
    expect(pk.map((x) => [x.cancelledAt, x.totalSessions, x.usedSessions])).toEqual([[null, 4, 0]]);
  });
});
