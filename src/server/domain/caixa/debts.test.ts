import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { clientDebtEntries, comandaItems, comandas, lists, professionals } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { money } from "@/lib/format";
import { recursoOffMessage } from "@/lib/caixa-recursos";
import { NEUTRAL_COMMISSION_RULES, type CommissionRules } from "@/lib/commission-rules";
import { addItem, addPayment, ApprovalNeededError, cancelComanda, closeComanda, openWalkInComanda, removeItem, reopenComanda, setComandaDiscount, updateItem } from "./comandas";
import { saveCaixaRules } from "./mode";
import { commissionReport, setCommission } from "./commission";
import { saveCommissionRules, setAssistantCommission } from "./commission-rules";
import { creditBalance } from "./credits";
import { debtBalance, openDebts } from "./debts";
import { cashSummary, openCash } from "./cash";
import { commissionLinesPort } from "../agenda/ports";
import { financeItens } from "../../reports/financeiro/itens";
import { getComandaDetail } from "../../queries/caixa";

/** Regras com a comissão da dívida "quando ela pagar" (a da Casa, migration 0063); o resto neutro para a conta ficar simples. */
const QUITACAO: CommissionRules = { ...NEUTRAL_COMMISSION_RULES, divida: "quitacao" };
const OCT = { from: "2026-10-01", to: "2026-10-31" };

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao); // Ana 40% no Corte
  await saveCommissionRules(QUITACAO, s.caixaGestao);
});

/** Comanda nova da cliente com o item que quita a dívida (e, se `pay`, recebida e fechada). */
async function quita(contactId: string, settlesComandaId: string, valueCents: number, o: { pay?: boolean } = { pay: true }) {
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "divida", settlesComandaId, unitCents: valueCents }, s.caixaRecepcao, NOW);
  if (o.pay) {
    await addPayment(w.comandaId, { method: "pix", valueCents }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
  }
  return w;
}
const linhas = async () => (await commissionReport(OCT)).rows.flatMap((r) => r.lines.map((l) => [r.name, l.status]));
const comandaRow = async (id: string) => (await db.select().from(comandas).where(eq(comandas.id, id)))[0];

describe("dívida da cliente", () => {
  it("Finalizar com falta deixa dívida e retém a comissão; quitar em duas vezes libera só no fim", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    expect((await comandaRow(comandaId)).debtCents).toBe(10000);
    expect(await debtBalance(p.contactId)).toBe(10000);
    expect(await openDebts(p.contactId)).toEqual([{ comandaId, number: 1, day: "2026-10-15", remainingCents: 10000 }]);
    const linha = async () => (await commissionReport(OCT)).rows[0].lines[0].status;
    expect(await linha()).toBe("aguardando_quitacao");
    // Retida não é pendência de regra: fica à parte (nunca somada).
    const rep = await commissionReport(OCT);
    expect([rep.pending, rep.held, rep.rows[0].commissionCents]).toEqual([0, 1, 0]);

    // Comanda 2: item "divida" de 6000 (o rótulo diz de qual comanda é).
    const c2 = await quita(p.contactId, comandaId, 6000);
    const [it2] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c2.comandaId));
    expect([it2.kind, it2.label, it2.professionalId, it2.settlesComandaId, it2.fiscalKind, it2.commissionCents]).toEqual(["divida", "Dívida da comanda 1 de 15/10", null, comandaId, "servico", null]);
    expect(await debtBalance(p.contactId)).toBe(4000);
    expect(await linha()).toBe("aguardando_quitacao"); // ainda falta 4000

    // Comanda 3: o resto, 4000. Passar do que falta é recusado.
    const c3 = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await expect(addItem(c3.comandaId, { kind: "divida", settlesComandaId: comandaId, unitCents: 4001 }, s.caixaRecepcao, NOW)).rejects.toThrow(`Passa do que falta da dívida (${money(4000)}).`);
    // Sem valor: entra o que falta.
    await addItem(c3.comandaId, { kind: "divida", settlesComandaId: comandaId }, s.caixaRecepcao, NOW);
    await addPayment(c3.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
    await closeComanda(c3.comandaId, {}, s.caixaRecepcao, NOW);
    expect(await linha()).toBe("ok");
    expect(await debtBalance(p.contactId)).toBe(0);
    expect(await openDebts(p.contactId)).toEqual([]);
    expect((await commissionReport(OCT)).rows[0].commissionCents).toBe(4800);
    // Os lançamentos: + na comanda 1, − de cada quitação com a comanda que pagou.
    const entries = await db.select().from(clientDebtEntries).where(eq(clientDebtEntries.comandaId, comandaId));
    expect(entries.map((e) => [e.deltaCents, e.paidInComandaId]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[-6000, c2.comandaId], [-4000, c3.comandaId], [10000, null]]);
  });

  it("a retenção vale também para a assistente do item retido", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    expect(await linhas()).toEqual([["Ana", "aguardando_quitacao"], ["Sidney", "aguardando_quitacao"]]);
    expect((await commissionLinesPort({ ...OCT, professionalId: sidney.id }))[0].status).toBe("aguardando_quitacao");
    await quita(p.contactId, comandaId, 10000);
    expect(await linhas()).toEqual([["Ana", "ok"], ["Sidney", "ok"]]);
  });

  it("com a regra 'na hora', a comissão sai já; sem cliente não deixa dívida; reabrir desfaz a dívida", async () => {
    await saveCommissionRules({ ...QUITACAO, divida: "agora" }, s.caixaGestao);
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    expect(await linhas()).toEqual([["Ana", "ok"]]);
    expect(await debtBalance(p.contactId)).toBe(10000);

    const semCliente = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(semCliente.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await expect(closeComanda(semCliente.comandaId, { leaveDebt: true }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a cliente para deixar a dívida.");
    // Sem leaveDebt, a falta continua travando o Finalizar.
    await expect(closeComanda(semCliente.comandaId, {}, s.caixaRecepcao, NOW)).rejects.toThrow(`Faltam ${money(12000)} para fechar.`);

    // Reabrir a comanda com dívida: debt_cents 0 e o lançamento + estornado.
    await reopenComanda(comandaId, { reason: "esqueceu o pix" }, s.caixaRecepcao, NOW);
    expect((await comandaRow(comandaId)).debtCents).toBe(0);
    expect(await debtBalance(p.contactId)).toBe(0);
    // Fechar de novo com a dívida: volta.
    await closeComanda(comandaId, { leaveDebt: true }, s.caixaRecepcao, NOW);
    expect(await debtBalance(p.contactId)).toBe(10000);
    // Já houve quitação: reabrir e cancelar a comanda da dívida são recusados.
    const c2 = await quita(p.contactId, comandaId, 3000);
    const n2 = (await comandaRow(c2.comandaId)).number;
    await expect(reopenComanda(comandaId, { reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow(`Parte desta dívida já foi paga na comanda ${n2}.`);
    await expect(cancelComanda(comandaId, { reason: "x" }, s.caixaGestao, NOW)).rejects.toThrow(`Parte desta dívida já foi paga na comanda ${n2}.`);
    expect(await debtBalance(p.contactId)).toBe(7000);
  });

  it("reabrir a comanda que quitou devolve a dívida e retém a comissão de novo; fechar outra vez quita de novo", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const c2 = await quita(p.contactId, comandaId, 10000);
    expect(await linhas()).toEqual([["Ana", "ok"]]);
    await reopenComanda(c2.comandaId, { reason: "valor errado" }, s.caixaRecepcao, NOW);
    expect(await debtBalance(p.contactId)).toBe(10000);
    expect(await linhas()).toEqual([["Ana", "aguardando_quitacao"]]);
    // Com a dívida devolvida, a comanda da dívida pode ser reaberta (nenhuma quitação viva).
    await closeComanda(c2.comandaId, {}, s.caixaRecepcao, NOW);
    expect(await debtBalance(p.contactId)).toBe(0);
    expect(await linhas()).toEqual([["Ana", "ok"]]);
    await cancelComanda(c2.comandaId, { reason: "estornou o pix" }, s.caixaGestao, NOW);
    expect(await debtBalance(p.contactId)).toBe(10000);
    await reopenComanda(comandaId, { reason: "corrigir" }, s.caixaRecepcao, NOW);
    expect(await debtBalance(p.contactId)).toBe(0);
  });

  it("a quitação é conferida de novo no Finalizar (duas comandas quitando a mesma dívida)", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const a = await quita(p.contactId, comandaId, 10000, { pay: false });
    const b = await quita(p.contactId, comandaId, 10000, { pay: false });
    await addPayment(a.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(b.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
    const r = await Promise.allSettled([closeComanda(a.comandaId, {}, s.caixaRecepcao, NOW), closeComanda(b.comandaId, {}, s.caixaRecepcao, NOW)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toBe(`Passa do que falta da dívida (${money(0)}).`);
    expect(await debtBalance(p.contactId)).toBe(0);
  });

  it("regras do item de dívida: só da mesma cliente, de comanda fechada com dívida, sem mudar valor nem trocar a cliente", async () => {
    const p = await cliente("Paula Souza");
    const q = await cliente("Quésia Lima");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const outra = await openWalkInComanda({ requestKey: randomUUID(), contactId: q.contactId }, s.caixaRecepcao, NOW);
    await expect(addItem(outra.comandaId, { kind: "divida", settlesComandaId: comandaId }, s.caixaRecepcao, NOW)).rejects.toThrow("Essa dívida não é desta cliente.");
    const balcao = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await expect(addItem(balcao.comandaId, { kind: "divida", settlesComandaId: comandaId }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a cliente para quitar a dívida.");
    const w = await quita(p.contactId, comandaId, 5000, { pay: false });
    await expect(addItem(w.comandaId, { kind: "divida", settlesComandaId: comandaId, unitCents: 5001 }, s.caixaRecepcao, NOW)).rejects.toThrow(`Passa do que falta da dívida (${money(5000)}).`);
    const [it] = await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, w.comandaId), isNull(comandaItems.cancelledAt)));
    await expect(updateItem(it.id, { unitCents: 4000, reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow("Tire o item da dívida e lance de novo com o valor certo.");
    const { setComandaClient } = await import("./comandas");
    await expect(setComandaClient(w.comandaId, { contactId: q.contactId }, s.caixaRecepcao, NOW)).rejects.toThrow("Tire o item da dívida antes de trocar a cliente.");
    // A própria comanda (aberta, sem dívida) não serve.
    const sem = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 12000 }] });
    await expect(addItem(w.comandaId, { kind: "divida", settlesComandaId: sem.comandaId }, s.caixaRecepcao, NOW)).rejects.toThrow("Essa comanda não tem dívida.");
  });

  it("detalhe da comanda: as dívidas abertas da cliente (sem a própria) e o que esta comanda deixou", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const d1 = await getComandaDetail(comandaId, s.cati.id);
    expect([d1?.debtCents, d1?.debts]).toEqual([10000, []]);
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    expect((await getComandaDetail(w.comandaId, s.cati.id))?.debts).toEqual([{ comandaId, number: 1, day: "2026-10-15", remainingCents: 10000 }]);
    // Já cobrada junto nesta comanda: some da lista (o que falta já está no item).
    await addItem(w.comandaId, { kind: "divida", settlesComandaId: comandaId, unitCents: 6000 }, s.caixaRecepcao, NOW);
    expect((await getComandaDetail(w.comandaId, s.cati.id))?.debts).toEqual([{ comandaId, number: 1, day: "2026-10-15", remainingCents: 4000 }]);
  });
});

describe("dinheiro e relatórios", () => {
  it("troco continua indo para o crédito da cliente (regra antiga) e o item de dívida fica fora do faturamento por profissional", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const w = await quita(p.contactId, comandaId, 10000, { pay: false });
    await addPayment(w.comandaId, { method: "dinheiro", valueCents: 15000 }, s.caixaRecepcao, NOW);
    const r = await closeComanda(w.comandaId, { saveChangeAsCredit: true }, s.caixaRecepcao, NOW);
    expect([r.creditCents, r.debtCents]).toEqual([5000, 0]);
    expect(await creditBalance(p.contactId)).toBe(5000);
    expect(await debtBalance(p.contactId)).toBe(0);
    const f = await financeItens(OCT);
    expect(f.professionals.map((x) => [x.name, x.crmCents, x.crmItens])).toEqual([["Ana", 12000, 1]]);
    expect(f.services.map((x) => x.label)).toEqual(["Corte"]);
  });

  it("a dívida não entra no esperado da gaveta: só o que foi pago", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const p = await cliente("Paula Souza");
    await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    const [open] = await db.select({ id: comandas.cashSessionId }).from(comandas);
    const sum = await cashSummary(open.id!);
    expect([sum.expected.pix, sum.expected.dinheiro]).toEqual([2000, 0]);
  });

  it("liga/desliga 'Dívida da cliente': desligado recusa deixar dívida; quitar a que já existe continua possível", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    await setSetting("caixa_recursos", { divida: false });
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await expect(closeComanda(w.comandaId, { leaveDebt: true }, s.caixaRecepcao, NOW)).rejects.toThrow(recursoOffMessage("divida"));
    expect((await getComandaDetail(w.comandaId, s.cati.id))?.dividaOn).toBe(false);
    // A antiga: quita normalmente.
    await quita(p.contactId, comandaId, 10000);
    expect(await debtBalance(p.contactId)).toBe(0);
    expect(await linhas()).toEqual([["Ana", "ok"]]);
  });
});

describe("revisão (fix 1): dívida não rola, cortesia não paga dívida, desconto fora da dívida", () => {
  const comDivida = async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
    return { p, comandaId };
  };

  it("rolar a dívida é recusado: comanda com item de dívida não deixa dívida nova (e a comissão segue retida)", async () => {
    const { p, comandaId } = await comDivida();
    const b = await quita(p.contactId, comandaId, 10000, { pay: false });
    await expect(closeComanda(b.comandaId, { leaveDebt: true }, s.caixaRecepcao, NOW)).rejects.toThrow("Tire o item da dívida antes de deixar dívida nesta comanda.");
    // Com um serviço junto e pagamento parcial, também.
    await addItem(b.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await addPayment(b.comandaId, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await expect(closeComanda(b.comandaId, { leaveDebt: true }, s.caixaRecepcao, NOW)).rejects.toThrow("Tire o item da dívida antes de deixar dívida nesta comanda.");
    expect(await debtBalance(p.contactId)).toBe(10000);
    expect(await linhas()).toEqual([["Ana", "aguardando_quitacao"]]);
  });

  it("cortesia não paga dívida: no receber e de novo no Finalizar", async () => {
    const { p, comandaId } = await comDivida();
    const b = await quita(p.contactId, comandaId, 10000, { pay: false });
    await expect(addPayment(b.comandaId, { method: "cortesia", valueCents: 10000, note: "amiga" }, s.caixaRecepcao, NOW)).rejects.toThrow("Cortesia não paga dívida.");
    const corte = await addItem(b.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await expect(addPayment(b.comandaId, { method: "cortesia", valueCents: 12001, note: "amiga" }, s.caixaRecepcao, NOW)).rejects.toThrow("Cortesia não paga dívida.");
    await addPayment(b.comandaId, { method: "cortesia", valueCents: 12000, note: "amiga" }, s.caixaRecepcao, NOW); // o Corte todo: pode
    await removeItem(corte.id, {}, s.caixaRecepcao, NOW); // sem o Corte, a cortesia ficaria pagando a dívida
    await addPayment(b.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW).catch(() => {});
    await expect(closeComanda(b.comandaId, {}, s.caixaRecepcao, NOW)).rejects.toThrow("Cortesia não paga dívida.");
    expect(await debtBalance(p.contactId)).toBe(10000);
  });

  it("Corte 100 + Dívida 100 com desconto de 20: quita 100, a base do Corte é 80 e a aprovação mede só o Corte", async () => {
    const { p, comandaId } = await comDivida();
    const b = await quita(p.contactId, comandaId, 10000, { pay: false });
    await db.update(lists).set({ priceCents: 10000 }).where(eq(lists.id, s.corte.id)); // Corte de tabela R$ 100 (sem preço mudado na conta)
    await addItem(b.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    // Limite de 20%: R$ 25 de desconto é 25% do Corte (não 12,5% da comanda) e pede a gestão.
    await saveCaixaRules({ toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: 2000 }, s.gestora.id);
    await expect(setComandaDiscount(b.comandaId, { cents: 2500, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await expect(setComandaDiscount(b.comandaId, { cents: 2500, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto e cortesia somam 25% da comanda, acima do limite de 20%: a gestão aprova.");
    // O desconto não passa do que não é dívida.
    await expect(setComandaDiscount(b.comandaId, { cents: 10001, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto maior que o total.");
    await setComandaDiscount(b.comandaId, { cents: 2000, reason: "promoção" }, s.caixaRecepcao, NOW);
    expect((await getComandaDetail(b.comandaId, s.cati.id))?.totals.totalCents).toBe(18000);
    await addPayment(b.comandaId, { method: "pix", valueCents: 18000 }, s.caixaRecepcao, NOW);
    await closeComanda(b.comandaId, {}, s.caixaRecepcao, NOW);
    expect(await debtBalance(p.contactId)).toBe(0); // quitou os 100 inteiros
    const its = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, b.comandaId));
    expect(its.find((i) => i.kind === "servico")?.commissionBaseCents).toBe(8000);
    const f = await financeItens(OCT);
    expect(f.professionals.map((x) => [x.name, x.crmCents])).toEqual([["Ana", 20000]]); // 12000 da comanda 1 + 8000 desta
  });

  it("comanda só com dívida não aceita desconto na comanda", async () => {
    const { p, comandaId } = await comDivida();
    const b = await quita(p.contactId, comandaId, 10000, { pay: false });
    await expect(setComandaDiscount(b.comandaId, { cents: 1000, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto não vale para dívida.");
    await expect(setComandaDiscount(b.comandaId, { percent: 10, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto não vale para dívida.");
  });
});
