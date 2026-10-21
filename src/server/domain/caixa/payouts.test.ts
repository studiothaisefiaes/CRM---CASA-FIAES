import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaItemAssistants, comandaItems, comandas, commissionPayouts, professionalAdjustments, professionals } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { CAIXA_RECURSOS_PADRAO, recursoOffMessage } from "@/lib/caixa-recursos";
import { NEUTRAL_COMMISSION_RULES } from "@/lib/commission-rules";
import { addItem, addPayment, cancelComanda, closeComanda, openWalkInComanda, reopenComanda, reopenForCorrection } from "./comandas";
import { commissionReport, setCommission } from "./commission";
import { saveCommissionRules, setAssistantCommission } from "./commission-rules";
import { addAdjustment, cancelAdjustment, saveAdjustmentRule } from "./adjustments";
import { closeCash, openCash } from "./cash";
import { getPayoutReceipt, listPayouts, payableFor, payCommission, undoPayout } from "./payouts";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao); // Ana 40% no Corte
});

const SET30 = "2026-09-30";
const corteAna = (day: string, o: { contactId?: string; pays?: { method: "pix"; valueCents: number }[]; leaveDebt?: boolean } = {}) =>
  comandaFechada(s, { day, contactId: o.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: o.pays ?? [{ method: "pix", valueCents: 12000 }], leaveDebt: o.leaveDebt });
const lanca = (kind: "vale" | "bonus" | "desconto", valueCents: number, day: string, note = "x", pro = s.ana.id) =>
  addAdjustment({ professionalId: pro, kind, valueCents, day, note }, s.caixaGestao);
const paga = (until = SET30, expectedNetCents: number, pro = s.ana.id) => payCommission({ professionalId: pro, until, expectedNetCents }, s.caixaGestao, NOW);

describe("pagar a comissão (decisão 10)", () => {
  it("a pagar até 30/09: comissões + bônus − vales − desconto; paga, numera e some do a pagar", async () => {
    const { comandaId } = await corteAna("2026-09-20"); // Corte 12.000 → 4.800
    await lanca("vale", 1000, "2026-09-25", "Adiantamento");
    await lanca("bonus", 500, "2026-09-28", "Meta");
    await corteAna("2026-10-02"); // fora do período
    const p = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(p.totals).toEqual({ commissionCents: 4800, bonusCents: 500, valesCents: 1000, descontosCents: 0, netCents: 4300 });
    expect(p).toMatchObject({ professionalId: s.ana.id, name: "Ana", fromDay: "2026-09-20", untilDay: SET30, pending: [] });
    expect(p.lines).toEqual([expect.objectContaining({ kind: "item", day: "2026-09-20", comandaNumber: 1, label: "Corte", commissionCents: 4800 })]);
    expect(p.adjustments.map((a) => [a.kind, a.valueCents, a.day, a.note])).toEqual([["vale", 1000, "2026-09-25", "Adiantamento"], ["bonus", 500, "2026-09-28", "Meta"]]);

    const r = await paga(SET30, 4300);
    expect(r).toMatchObject({ number: 1, netCents: 4300 });
    expect((await payableFor({ professionalId: s.ana.id, until: SET30 })).lines).toEqual([]);
    expect((await payableFor({ professionalId: s.ana.id, until: SET30 })).adjustments).toEqual([]);
    const [row] = await db.select().from(commissionPayouts);
    expect(row).toMatchObject({ number: 1, professionalId: s.ana.id, fromDay: "2026-09-20", untilDay: SET30, commissionCents: 4800, bonusCents: 500, valesCents: 1000, descontosCents: 0, carriedCents: 0, netCents: 4300, paidBy: s.gestora.id });
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId));
    expect(it.payoutId).toBe(r.id);
    // O relatório mostra o recibo que pagou a linha.
    const rep = await commissionReport({ from: "2026-09-01", to: "2026-09-30" });
    expect(rep.rows[0].lines[0]).toMatchObject({ payoutNumber: 1, payoutId: r.id });
    // Auditoria: quem, o depois e o recibo congelado.
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "comissao_paga"));
    expect(a).toMatchObject({ userId: s.gestora.id, entityId: r.id });
    expect(a.data).toMatchObject({ antes: null, depois: { numero: 1, netCents: 4300 } });
  });

  it("dois cliques ao mesmo tempo: um recibo só", async () => {
    await corteAna("2026-09-20");
    const both = await Promise.allSettled([1, 2].map(() => paga(SET30, 4800)));
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(commissionPayouts)).toHaveLength(1);
    const rejected = both.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/Nada a pagar|O valor mudou/);
  });

  it("valor mudou desde que abriu: recusa com o novo valor; sem nada, recusa", async () => {
    await expect(paga(SET30, 0)).rejects.toThrow("Nada a pagar até 30/09/2026.");
    await corteAna("2026-09-20");
    await expect(paga(SET30, 9999)).rejects.toThrow("O valor mudou desde que você abriu (agora R$ 48,00). Confira de novo.");
    expect(await db.select().from(commissionPayouts)).toHaveLength(0);
  });

  it("vales maiores que a comissão: recibo de R$ 0 e o saldo vira desconto na comissão do dia seguinte; desfazer devolve tudo", async () => {
    await corteAna("2026-09-20");
    const vale = await lanca("vale", 6000, "2026-09-25", "Adiantamento");
    const p = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(p.totals).toEqual({ commissionCents: 4800, bonusCents: 0, valesCents: 6000, descontosCents: 0, netCents: 0 });
    const { id } = await paga(SET30, 0);
    const [row] = await db.select().from(commissionPayouts);
    expect([row.netCents, row.carriedCents]).toEqual([0, 1200]);
    const [carried] = await db.select().from(professionalAdjustments).where(eq(professionalAdjustments.carriedFromPayoutId, id));
    expect(carried).toMatchObject({ kind: "desconto", valueCents: 1200, day: "2026-10-01", note: "Saldo do recibo nº 1", payoutId: null, professionalId: s.ana.id });
    // O saldo entra no próximo a pagar.
    expect((await payableFor({ professionalId: s.ana.id, until: "2026-10-31" })).totals.descontosCents).toBe(1200);

    await expect(undoPayout(id, { reason: " " }, s.caixaGestao, NOW)).rejects.toThrow("Escreva o motivo.");
    await undoPayout(id, { reason: "pago errado" }, s.caixaGestao, NOW);
    // Linhas e vale voltam ao a pagar; o desconto levado é cancelado.
    const back = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(back.lines).toHaveLength(1);
    expect(back.adjustments.map((a) => a.id)).toEqual([vale.id]);
    expect((await db.select().from(professionalAdjustments).where(eq(professionalAdjustments.id, carried.id)))[0]).toMatchObject({ cancelReason: "pago errado" });
    expect((await payableFor({ professionalId: s.ana.id, until: "2026-10-31" })).totals.descontosCents).toBe(0);
    expect((await db.select().from(commissionPayouts))[0]).toMatchObject({ cancelReason: "pago errado", cancelledBy: s.gestora.id });
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "comissao_pagamento_desfeito"));
    expect(a.data).toMatchObject({ antes: { numero: 1, netCents: 0, carriedCents: 1200 }, depois: null, motivo: "pago errado" });
    // O recibo desfeito continua legível, congelado como foi pago.
    const rec = await getPayoutReceipt(id);
    expect(rec).toMatchObject({ number: 1, carriedCents: 1200, totals: { netCents: 0 }, cancelReason: "pago errado" });
    expect(rec!.cancelledAt).not.toBeNull();
    expect(rec!.lines).toHaveLength(1);
    // Pagar de novo dá o recibo nº 2.
    expect(await paga(SET30, 0)).toMatchObject({ number: 2 });
  });

  it("desfazer recusa quando o saldo levado já entrou em outro recibo", async () => {
    await corteAna("2026-09-20");
    await lanca("vale", 6000, "2026-09-25");
    const first = await paga(SET30, 0);
    await corteAna("2026-10-02");
    await paga("2026-10-14", 3600); // 4.800 − 1.200 do saldo
    await expect(undoPayout(first.id, { reason: "x" }, s.caixaGestao, NOW)).rejects.toThrow("O saldo deste recibo já entrou no recibo nº 2. Desfaça esse pagamento antes.");
  });

  it("os 'todo mês' até a data nascem no a pagar e no pagamento", async () => {
    await corteAna("2026-09-20");
    await saveAdjustmentRule({ professionalId: s.ana.id, kind: "bonus", valueCents: 300, dayOfMonth: 5, startsOn: "2026-09-01", note: "Meta", active: true }, s.caixaGestao);
    const p = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(p.adjustments.map((a) => [a.kind, a.day])).toEqual([["bonus", "2026-09-05"]]);
    expect(p.totals.netCents).toBe(5100);
    await paga(SET30, 5100);
    expect((await db.select().from(professionalAdjustments).where(isNotNull(professionalAdjustments.payoutId)))).toHaveLength(1);
  });

  it("liga/desliga: 'Pagar a comissão' desligado recusa pagar; desfazer e ver o recibo continuam", async () => {
    await corteAna("2026-09-20");
    const { id } = await paga(SET30, 4800);
    await corteAna("2026-09-21");
    await setSetting("caixa_recursos", { ...CAIXA_RECURSOS_PADRAO, pagarComissao: false });
    await expect(paga(SET30, 4800)).rejects.toThrow(recursoOffMessage("pagarComissao"));
    expect(await getPayoutReceipt(id)).toMatchObject({ number: 1 });
    await undoPayout(id, { reason: "desfeito" }, s.caixaGestao, NOW);
    expect((await payableFor({ professionalId: s.ana.id, until: SET30 })).totals.commissionCents).toBe(9600);
  });

  it("listPayouts: os recibos, do mais novo, com o nome e quem pagou", async () => {
    await corteAna("2026-09-20");
    await paga(SET30, 4800);
    expect(await listPayouts({ professionalId: s.ana.id })).toEqual([expect.objectContaining({ number: 1, professionalName: "Ana", netCents: 4800, untilDay: SET30, paidByName: "Thaíse", cancelledAt: null })]);
    expect(await listPayouts({ professionalId: s.bia.id })).toEqual([]);
  });
});

describe("comanda com comissão paga (decisão 11)", () => {
  it("não reabre nem cancela; nada muda", async () => {
    const { comandaId } = await corteAna("2026-09-20");
    await paga(SET30, 4800);
    const msg = "A comissão de Ana desta comanda já foi paga no recibo nº 1. Desfaça o pagamento em Comissão antes.";
    await expect(reopenComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(cancelComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(reopenForCorrection(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    const [c] = await db.select().from(comandas).where(eq(comandas.id, comandaId));
    expect(c.status).toBe("fechada");
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId));
    expect([it.commissionCents, it.cancelledAt]).toEqual([4800, null]);
    expect(it.payoutId).not.toBeNull();
  });

  it("a assistente paga também trava a comanda", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    const { comandaId } = await corteAna("2026-09-20");
    await paga(SET30, 1200, sidney.id);
    await expect(reopenComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow("A comissão de Sidney desta comanda já foi paga no recibo nº 1.");
  });

  it("depois de desfazer o pagamento, reabre", async () => {
    const { comandaId } = await corteAna("2026-09-20");
    const { id } = await paga(SET30, 4800);
    await undoPayout(id, { reason: "corrigir preço" }, s.caixaGestao, NOW);
    await reopenComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0].status).toBe("aberta");
  });

  it("a comanda que quitou a dívida não reabre nem cancela se a comissão liberada já foi paga", async () => {
    await saveCommissionRules({ ...NEUTRAL_COMMISSION_RULES, divida: "quitacao" }, s.caixaGestao);
    const p = await cliente("Paula Souza");
    const { comandaId: devida } = await corteAna("2026-10-10", { contactId: p.contactId, pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "divida", settlesComandaId: devida, unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    await paga("2026-10-14", 4800);
    const msg = "A comissão de Ana da comanda 1 de 10/10 já foi paga no recibo nº 1. Desfaça o pagamento em Comissão antes.";
    await expect(reopenComanda(w.comandaId, { reason: "valor errado" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(cancelComanda(w.comandaId, { reason: "estorno" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, devida));
    expect([it.commissionHeld, it.payoutId != null]).toEqual([false, true]);
  });

  it("a comanda que quitou reabre quando a comanda devida não reteve a comissão", async () => {
    const p = await cliente("Paula Souza"); // regra neutra: comissão da dívida "agora"
    const { comandaId: devida } = await corteAna("2026-10-10", { contactId: p.contactId, pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "divida", settlesComandaId: devida, unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    await paga("2026-10-14", 4800);
    await reopenComanda(w.comandaId, { reason: "valor errado" }, s.caixaGestao, NOW);
  });
});

describe("assistente e retida", () => {
  it("assistente recebe pelo próprio recibo; comissão retida pela dívida não entra", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    await saveCommissionRules({ ...NEUTRAL_COMMISSION_RULES, divida: "quitacao" }, s.caixaGestao);
    await corteAna("2026-09-20");
    const p = await cliente("Paula Souza");
    await corteAna("2026-09-22", { contactId: p.contactId, pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });

    const sid = await payableFor({ professionalId: sidney.id, until: SET30 });
    expect(sid.lines).toEqual([expect.objectContaining({ kind: "assistente", day: "2026-09-20", label: "Corte (assistente de Ana)", commissionCents: 1200 })]);
    expect(sid.pending).toEqual([{ day: "2026-09-22", label: "Corte (assistente de Ana)", why: "aguardando_quitacao" }]);
    const ana = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(ana.lines.map((l) => [l.kind, l.commissionCents])).toEqual([["item", 4800]]);
    expect(ana.pending).toEqual([{ day: "2026-09-22", label: "Corte", why: "aguardando_quitacao" }]);

    const r = await paga(SET30, 1200, sidney.id);
    const [a] = await db.select().from(comandaItemAssistants).where(eq(comandaItemAssistants.professionalId, sidney.id)).orderBy(comandaItemAssistants.createdAt);
    expect(a.payoutId).toBe(r.id);
    // A linha principal da Ana continua no a pagar dela.
    expect((await payableFor({ professionalId: s.ana.id, until: SET30 })).totals.commissionCents).toBe(4800);
    const rec = await getPayoutReceipt(r.id);
    expect(rec!.lines).toEqual([expect.objectContaining({ kind: "assistente", commissionCents: 1200 })]);
  });

  it("linha sem regra fica em pendente e não é paga", async () => {
    await comandaFechada(s, { day: "2026-09-20", items: [{ serviceId: s.hidratacao.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 9000 }] });
    const p = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(p.lines).toEqual([]);
    expect(p.pending).toEqual([{ day: "2026-09-20", label: "Hidratação", why: "sem_regra" }]);
    await expect(paga(SET30, 0)).rejects.toThrow("Nada a pagar até 30/09/2026.");
    expect(await db.select().from(comandaItems).where(and(eq(comandaItems.professionalId, s.ana.id), isNotNull(comandaItems.payoutId)))).toHaveLength(0);
  });
});

describe("rodada de correção 1", () => {
  it("o recibo congelado fica na coluna do pagamento (lido sem a auditoria)", async () => {
    await corteAna("2026-09-20");
    const { id } = await paga(SET30, 4800);
    const [row] = await db.select().from(commissionPayouts);
    expect(row.receipt).toMatchObject({ lines: [expect.objectContaining({ kind: "item", commissionCents: 4800 })], adjustments: [] });
    await db.delete(auditLog).where(eq(auditLog.action, "comissao_paga"));
    expect((await getPayoutReceipt(id))!.lines).toHaveLength(1);
  });

  it("o saldo levado não se cancela à mão: vem do recibo", async () => {
    await corteAna("2026-09-20");
    await lanca("vale", 6000, "2026-09-25");
    const { id } = await paga(SET30, 0);
    const [carried] = await db.select().from(professionalAdjustments).where(eq(professionalAdjustments.carriedFromPayoutId, id));
    await expect(cancelAdjustment(carried.id, { reason: "x" }, s.caixaGestao)).rejects.toThrow("Este saldo vem do recibo nº 1. Desfaça o recibo para mudar.");
  });

  it("'Pagar comissão a partir de': comanda, assistente e lançamento antes da data ficam fora do A pagar e não são pagos", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    const { comandaId: antiga } = await corteAna("2026-09-10");
    await lanca("vale", 1000, "2026-09-12");
    await corteAna("2026-09-20");
    await setSetting("caixa_recursos", { ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: "2026-09-15" });
    const p = await payableFor({ professionalId: s.ana.id, until: SET30 });
    expect(p.lines.map((l) => l.day)).toEqual(["2026-09-20"]);
    expect(p.adjustments).toEqual([]);
    expect(p.fromDay).toBe("2026-09-20");
    expect((await payableFor({ professionalId: sidney.id, until: SET30 })).lines.map((l) => l.day)).toEqual(["2026-09-20"]);
    await paga(SET30, 4800);
    const [old] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, antiga));
    expect(old.payoutId).toBeNull();
  });

  it("decisão 11 vem antes das outras recusas: com o caixa do pagamento já fechado, reabrir e cancelar dizem o recibo", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const { comandaId } = await corteAna("2026-10-15");
    await closeCash({ cashBreakdown: {}, counted: { pix: 12000 } }, s.caixaRecepcao, NOW);
    await paga("2026-10-15", 4800);
    const msg = "A comissão de Ana desta comanda já foi paga no recibo nº 1. Desfaça o pagamento em Comissão antes.";
    await expect(reopenComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(cancelComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(reopenForCorrection(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    // Sem permissão de outro dia (recepção, comanda de outro dia) também ouve o recibo primeiro.
    const { comandaId: velha } = await corteAna("2026-09-20");
    await paga(SET30, 4800);
    await expect(reopenComanda(velha, { reason: "preço" }, s.caixaRecepcao, NOW)).rejects.toThrow("já foi paga no recibo nº 2");
  });

  it("decisão 11 ampliada vem antes das outras recusas na comanda que quitou", async () => {
    await saveCommissionRules({ ...NEUTRAL_COMMISSION_RULES, divida: "quitacao" }, s.caixaGestao);
    const p = await cliente("Paula Souza");
    const { comandaId: devida } = await corteAna("2026-10-10", { contactId: p.contactId, pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "divida", settlesComandaId: devida, unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    await closeCash({ cashBreakdown: {}, counted: { pix: 10000 } }, s.caixaRecepcao, NOW);
    await paga("2026-10-14", 4800);
    const msg = "A comissão de Ana da comanda 1 de 10/10 já foi paga no recibo nº 1.";
    await expect(reopenComanda(w.comandaId, { reason: "x" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
    await expect(cancelComanda(w.comandaId, { reason: "x" }, s.caixaGestao, NOW)).rejects.toThrow(msg);
  });
});
