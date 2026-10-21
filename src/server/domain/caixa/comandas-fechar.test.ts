import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments, clientCreditEntries, clientPackages, comandaItems, comandas, packageDefs, packageUses, professionals, professionalServices } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { money } from "@/lib/format";
import { createVisit } from "../agenda/visits";
import { addCreditTx } from "./credits";
import { openCash } from "./cash";
import { addItem, addPayment, closeComanda, openComandaForAppointment, openWalkInComanda, reopenComanda, setComandaDiscount } from "./comandas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

async function visitaAberta(contactId: string, items: { serviceId: string; professionalId: string }[], h = 10) {
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId }, startsAt: bahia(15, h).toISOString(), items: items.map((i, k) => ({ ...i, preference: "escolhida" as const, mode: k ? "depois" as const : undefined })) }, s.recepcao, bahia(15, 8));
  return { ...(await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW)), appointmentIds: v.appointmentIds };
}
const comissao = (pro: string, svc: string, bp: number) => db.update(professionalServices).set({ commissionBp: bp }).where(and(eq(professionalServices.professionalId, pro), eq(professionalServices.serviceId, svc)));

describe("fechar", () => {
  it("3 formas com troco; comissão congelada sobre o valor com desconto; 'sem regra' fica vazia; horários viram Finalizado mesmo antes da hora", async () => {
    await comissao(s.ana.id, s.corte.id, 4000);
    const p = await cliente("Paula Souza");
    const c = await visitaAberta(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    await setComandaDiscount(c.comandaId, { cents: 2100, reason: "aniversário" }, s.caixaRecepcao, NOW); // 21.000 − 2.100 = 18.900
    await addPayment(c.comandaId, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "credito", valueCents: 10000, installments: 2, brand: "visa" }, s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "dinheiro", valueCents: 5000 }, s.caixaRecepcao, NOW);
    const r = await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW); // NOW = 09:00, o horário é 10:00
    expect(r).toEqual({ number: 1, day: "2026-10-15", totalCents: 18900, changeCents: 1100, creditCents: 0, debtCents: 0 });
    const itens = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId)).orderBy(comandaItems.createdAt);
    expect(itens.map((i) => [i.label, i.commissionBp, i.commissionBaseCents, i.commissionCents])).toEqual([
      ["Corte", 4000, 10800, 4320], // 12.000 − 1.200 (a parte dele no desconto)
      ["Hidratação", null, 8100, null], // sem regra
    ]);
    expect((await db.select().from(appointments).where(eq(appointments.visitId, (await db.select().from(comandas).where(eq(comandas.id, c.comandaId)))[0].visitId!))).map((a) => a.status)).toEqual(["compareceu", "compareceu"]);
    await comissao(s.ana.id, s.corte.id, 5000); // mudar a regra depois não mexe no retrato
    expect((await db.select().from(comandaItems).where(eq(comandaItems.id, itens[0].id)))[0].commissionCents).toBe(4320);
  });

  it("cortesia (QA r58, C-3) sai da base da comissão: 100% de cortesia não comissiona; parte em cortesia tira só a parte rateada", async () => {
    await comissao(s.bia.id, s.hidratacao.id, 4000);
    await comissao(s.ana.id, s.corte.id, 4000);
    const p = await cliente("Paula Souza");
    const toda = await visitaAberta(p.contactId, [{ serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    await addPayment(toda.comandaId, { method: "cortesia", valueCents: 9000, note: "aniversário" }, s.caixaRecepcao, NOW);
    await closeComanda(toda.comandaId, {}, s.caixaRecepcao, NOW);
    const q = await cliente("Rita Lima");
    const parte = await visitaAberta(q.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }], 11);
    // 21.000: 7.000 de cortesia rateados pelo valor (Corte 4.000, Hidratação 3.000); o resto em Pix.
    await addPayment(parte.comandaId, { method: "cortesia", valueCents: 7000, note: "retoque" }, s.caixaRecepcao, NOW);
    await addPayment(parte.comandaId, { method: "pix", valueCents: 14000 }, s.caixaRecepcao, NOW);
    await closeComanda(parte.comandaId, {}, s.caixaRecepcao, NOW);
    const base = async (comandaId: string) => (await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId)).orderBy(comandaItems.createdAt))
      .map((i) => [i.label, i.commissionBaseCents, i.commissionCents]);
    expect(await base(toda.comandaId)).toEqual([["Hidratação", 0, 0]]);
    expect(await base(parte.comandaId)).toEqual([["Corte", 8000, 3200], ["Hidratação", 6000, 2400]]);
  });

  it("troco guardado como crédito: lança +troco e não devolve dinheiro", async () => {
    const p = await cliente("Paula Souza");
    const c = await visitaAberta(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }]);
    await addPayment(c.comandaId, { method: "dinheiro", valueCents: 15000 }, s.caixaRecepcao, NOW);
    expect(await closeComanda(c.comandaId, { saveChangeAsCredit: true }, s.caixaRecepcao, NOW)).toMatchObject({ changeCents: 0, creditCents: 3000 });
    expect((await db.select().from(clientCreditEntries))[0]).toMatchObject({ contactId: p.contactId, deltaCents: 3000, reason: "troco", comandaId: c.comandaId });
  });

  it("recusas: preço vazio, pagamento que não bate, forma que não é dinheiro passando do total e caixa fechado quando exigido", async () => {
    const m = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(m.comandaId, { kind: "servico", serviceId: s.mechas.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW); // Mechas não tem preço
    await expect(closeComanda(m.comandaId, {}, s.caixaRecepcao, NOW)).rejects.toThrow("Falta o preço de Mechas.");
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 3000 }, s.caixaRecepcao, NOW);
    await expect(closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW)).rejects.toThrow(`Faltam ${money(1000)} para fechar.`);
    // Plano 3: a forma que não é dinheiro não passa do restante já no lançamento; "exigir caixa aberto" vale no receber (payments.test).
    await expect(addPayment(w.comandaId, { method: "debito", valueCents: 2000, brand: "visa" }, s.caixaRecepcao, NOW)).rejects.toThrow(`Passa do que falta (${money(1000)}). Só o dinheiro pode passar e virar troco.`);
  });

  it("pagar hoje um horário de amanhã não o finaliza (fica como pago antes do horário)", async () => {
    const p = await cliente("Paula Souza");
    const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(16, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, NOW);
    const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, NOW);
    expect(await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW)).toMatchObject({ day: "2026-10-15" });
    expect((await db.select().from(appointments).where(eq(appointments.id, v.appointmentIds[0])))[0].status).toBe("agendado");
  });

  it("liga ao caixa aberto, quando há", async () => {
    const { id } = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, w.comandaId)))[0]).toMatchObject({ status: "fechada", cashSessionId: id, closedBy: s.cati.id });
  });
});

describe("valor do item na nota (Fase D)", () => {
  it("fechar grava net_cents com desconto e cortesia rateados, e o CNPJ da parceira (só de quem é parceira)", async () => {
    await db.update(professionals).set({ bond: "parceira", cnpj: "11222333000181" }).where(eq(professionals.id, s.ana.id));
    await db.update(professionals).set({ bond: "clt" }).where(eq(professionals.id, s.bia.id));
    const p = await cliente("Paula Souza");
    // Corte 10000 (Ana, parceira) + Hidratação 5000 (Bia, CLT); desconto da comanda 1500; cortesia 1350.
    const c = await visitaAberta(p.contactId, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    await db.update(comandaItems).set({ unitCents: 10000 }).where(and(eq(comandaItems.comandaId, c.comandaId), eq(comandaItems.label, "Corte")));
    await db.update(comandaItems).set({ unitCents: 5000 }).where(and(eq(comandaItems.comandaId, c.comandaId), eq(comandaItems.label, "Hidratação")));
    await setComandaDiscount(c.comandaId, { cents: 1500, reason: "aniversário" }, s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "cortesia", valueCents: 1350, note: "retoque" }, s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "pix", valueCents: 12150 }, s.caixaRecepcao, NOW);
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW);
    const items = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId)).orderBy(comandaItems.createdAt);
    expect(items.map((i) => [i.label, i.netCents, i.partnerCnpj])).toEqual([["Corte", 8100, "11222333000181"], ["Hidratação", 4050, null]]);
  });
  it("produto também ganha net_cents; reabrir limpa o retrato e fechar de novo refaz", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    const get = async () => (await db.select().from(comandaItems).where(eq(comandaItems.comandaId, w.comandaId)))[0];
    expect(await get()).toMatchObject({ netCents: 4000, partnerCnpj: null });
    await reopenComanda(w.comandaId, { reason: "erro" }, s.caixaRecepcao, NOW);
    expect(await get()).toMatchObject({ netCents: null, partnerCnpj: null });
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    expect((await get()).netCents).toBe(4000);
  });
});

describe("pacotes", () => {
  it("venda: as linhas do pacote nascem ao fechar (uma por serviço), com validade e valor por sessão; preço só com um serviço", async () => {
    const p = await cliente("Paula Souza");
    const [def] = await db.insert(packageDefs).values({ name: "Combo Método Fiaes", priceCents: 40000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10000 }] }).returning();
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    const { id: itemId } = await addItem(w.comandaId, { kind: "pacote_venda", packageDefId: def.id }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 40000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    expect(await db.select().from(clientPackages).where(eq(clientPackages.origin, "crm"))).toEqual([expect.objectContaining({
      contactId: p.contactId, packageName: "Combo Método Fiaes", serviceLabel: "Corte", totalSessions: 4, usedSessions: 0, priceCents: 40000, unitCents: 10000,
      purchasedOn: "2026-10-15", validUntil: "2027-01-13", externalKey: `crm:pac:${itemId}:${s.corte.id}`, packageDefId: def.id, comandaItemId: itemId,
    })]);
  });

  it("sessão: baixa no pacote, registra o uso e congela a comissão pelo valor da sessão; sem valor da sessão, fica vazia", async () => {
    await comissao(s.ana.id, s.corte.id, 4000);
    const p = await cliente("Paula Souza");
    const [comValor, semValor] = await db.insert(clientPackages).values([
      { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, unitCents: 10000, validUntil: "2027-01-01", externalKey: "t:1" },
      { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo Avec", serviceLabel: "Corte", totalSessions: 2, usedSessions: 0, validUntil: "2027-01-01", externalKey: "t:2" },
    ]).returning();
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    const a = await addItem(w.comandaId, { kind: "pacote_sessao", clientPackageId: comValor.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "pacote_sessao", clientPackageId: semValor.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW); // total zero: nada a pagar
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, comValor.id)))[0].usedSessions).toBe(2);
    expect(await db.select().from(packageUses).where(eq(packageUses.externalKey, `crm:uso:${a.id}`))).toEqual([expect.objectContaining({ clientPackageId: comValor.id, professionalId: s.ana.id, origin: "crm", usedOn: "2026-10-15" })]);
    const itens = await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, w.comandaId), isNull(comandaItems.cancelledAt))).orderBy(comandaItems.createdAt);
    expect(itens.map((i) => [i.commissionBaseCents, i.commissionCents])).toEqual([[10000, 4000], [null, null]]);
  });
});

describe("Review Focus 5: disputas ao mesmo tempo", () => {
  it("duas pessoas fechando a mesma comanda: a segunda vê quem fechou", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
    const r = await Promise.allSettled([closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW), closeComanda(w.comandaId, {}, s.caixaGestao, NOW)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/^Essa comanda acabou de ser fechada por (Cati|Thaíse)$/);
  });

  it("a última sessão do pacote em duas comandas: a segunda vê 'não tem mais sessões'", async () => {
    const p = await cliente("Paula Souza");
    const [cp] = await db.insert(clientPackages).values({ contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 3, validUntil: "2027-01-01", externalKey: "t:1" }).returning();
    const abrir = async () => {
      const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
      await addItem(w.comandaId, { kind: "pacote_sessao", clientPackageId: cp.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
      return w.comandaId;
    };
    const [a, b] = [await abrir(), await abrir()];
    const r = await Promise.allSettled([closeComanda(a, {}, s.caixaRecepcao, NOW), closeComanda(b, {}, s.caixaRecepcao, NOW)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toBe("O pacote de Paula não tem mais sessões.");
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, cp.id)))[0].usedSessions).toBe(4);
  });

  it("o crédito da cliente usado em duas comandas nunca fica negativo", async () => {
    const p = await cliente("Paula Souza");
    await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 3000, reason: "troco" }, s.cati.id));
    const abrir = async () => {
      const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
      await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 2000 }, s.caixaRecepcao, NOW);
      await addPayment(w.comandaId, { method: "credito_cliente", valueCents: 2000 }, s.caixaRecepcao, NOW);
      return w.comandaId;
    };
    const [a, b] = [await abrir(), await abrir()];
    const r = await Promise.allSettled([closeComanda(a, {}, s.caixaRecepcao, NOW), closeComanda(b, {}, s.caixaRecepcao, NOW)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toBe(`Saldo insuficiente: Paula tem ${money(1000)} de crédito.`);
  });
});
