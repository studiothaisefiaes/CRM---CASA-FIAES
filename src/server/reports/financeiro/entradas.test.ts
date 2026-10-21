import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { payment } from "../../../../test/salon-fixtures";
import { caixa, comanda } from "../../../../test/financeiro-fixtures";
import { financeEntradas } from "./entradas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const DIA = { from: "2026-10-15", to: "2026-10-15", grain: "dia" as const };

describe("Financeiro: entradas", () => {
  it("CRM: pagamento vivo de comanda não cancelada; troco sai do dinheiro; cortesia fora das entradas", async () => {
    const cx = await caixa({ day: "2026-10-15", by: s.cati.id });
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: cx.id, changeCents: 1000,
      pays: [{ method: "pix", valueCents: 5000 }, { method: "dinheiro", valueCents: 7000 }, { method: "pix", valueCents: 4000, cancelled: true }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, pays: [{ method: "cortesia", valueCents: 3000 }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, status: "cancelada", pays: [{ method: "pix", valueCents: 9000 }] });
    const e = await financeEntradas(DIA);
    expect(e.crm).toEqual({ entradasCents: 11000, comandas: 2, ticketCents: 5500, taxasCents: 0, liquidoCents: 11000 });
    expect(e.methods.find((m) => m.key === "dinheiro")).toMatchObject({ crmCents: 6000, crmN: 1, avecCents: 0 });
    expect(e.methods.find((m) => m.key === "pix")).toMatchObject({ crmCents: 5000, crmN: 1 });
    expect(e.methods.find((m) => m.key === "cortesia")).toMatchObject({ revenue: false, crmCents: 3000, label: "Cortesia" });
    expect(e.days).toEqual([{ key: "2026-10-15", label: "15/10", crmCents: 11000, avecCents: 0 }]);
    expect(e.cashiers).toEqual([
      expect.objectContaining({ sessionId: cx.id, userName: "Cati", entradasCents: 11000, comandas: 1, status: "fechado", day: "2026-10-15" }),
      expect.objectContaining({ sessionId: null, userName: "Sem caixa aberto", entradasCents: 0, comandas: 1 }),
    ]);
  });

  it("taxa do cartão e líquido do CRM; a diferença com o Avec continua pelo bruto", async () => {
    const cx = await caixa({ day: "2026-10-15", by: s.cati.id });
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: cx.id,
      pays: [{ method: "credito", valueCents: 10000, feeCents: 243 }, { method: "credito", valueCents: 10000, feeCents: 570 }, { method: "pix", valueCents: 5000 }, { method: "credito", valueCents: 3000, feeCents: 90, cancelled: true }] });
    await payment({ day: "2026-10-15", comanda: "1", method: "Pix", value: 20000 });
    const e = await financeEntradas(DIA);
    expect(e.crm.entradasCents).toBe(25000);
    expect(e.crm.taxasCents).toBe(813);
    expect(e.crm.liquidoCents).toBe(e.crm.entradasCents - 813);
    expect(e.avec).toMatchObject({ taxasCents: 0, liquidoCents: 20000 });
    expect(e.methods.find((m) => m.key === "credito")).toMatchObject({ crmCents: 20000, crmFeeCents: 813 });
    expect(e.methods.find((m) => m.key === "pix")).toMatchObject({ crmFeeCents: 0 });
  });

  it("caixa por pessoa: cada pagamento entra no caixa de quem recebeu (não no de quem fechou a comanda), com o troco dele", async () => {
    const cati = await caixa({ day: "2026-10-15", by: s.cati.id, status: "aberto" });
    const gestora = await caixa({ day: "2026-10-15", by: s.gestora.id, differenceCents: 0 });
    await comanda({ day: "2026-10-15", by: s.gestora.id, cashSessionId: gestora.id, changeCents: 1000,
      pays: [{ method: "pix", valueCents: 5000, cashSessionId: cati.id }, { method: "dinheiro", valueCents: 7000 }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: cati.id, pays: [{ method: "pix", valueCents: 2000, cashSessionId: null }] });
    const e = await financeEntradas(DIA);
    expect(e.crm).toEqual({ entradasCents: 13000, comandas: 2, ticketCents: 6500, taxasCents: 0, liquidoCents: 13000 });
    expect(e.cashiers).toHaveLength(3); // os dois abriram às 9h: a ordem entre eles não importa aqui
    expect(e.cashiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: cati.id, userName: "Cati", entradasCents: 5000, comandas: 1, status: "aberto" }),
      expect.objectContaining({ sessionId: gestora.id, userName: "Thaíse Fiaes", entradasCents: 6000, comandas: 1, status: "fechado", differenceCents: 0 }),
      expect.objectContaining({ sessionId: null, userName: "Sem caixa aberto", entradasCents: 2000, comandas: 1 }),
    ]));
  });

  it("comanda fechada sem pagamento (só sessão de pacote) não conta no ticket nem no caixa, como no Avec e no Salão", async () => {
    const cx = await caixa({ day: "2026-10-15", by: s.cati.id });
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: cx.id, pays: [{ method: "pix", valueCents: 10000 }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: cx.id, items: [{ label: "Escova", kind: "pacote_sessao", unitCents: 0 }] });
    const e = await financeEntradas(DIA);
    expect(e.crm).toEqual({ entradasCents: 10000, comandas: 1, ticketCents: 10000, taxasCents: 0, liquidoCents: 10000 });
    expect(e.cashiers).toEqual([expect.objectContaining({ sessionId: cx.id, comandas: 1, entradasCents: 10000 })]);
  });

  it("Avec: pela data do pagamento, com o crédito da cliente negativo; comanda = dia + número", async () => {
    await payment({ day: "2026-10-15", comanda: "1", method: "Cartão Crédito (Visa)", value: 10000 });
    await payment({ day: "2026-10-15", comanda: "1", method: "Crédito Cliente", value: -2000 });
    await payment({ day: "2026-10-15", comanda: "2", method: "Pix", value: 5000, paidOn: "2026-10-16" });
    await payment({ day: "2026-10-15", comanda: "3", method: "Dívida", value: 700 });
    const e = await financeEntradas(DIA);
    expect(e.avec).toEqual({ entradasCents: 8700, comandas: 2, ticketCents: 4350, taxasCents: 0, liquidoCents: 8700 });
    expect(e.methods.find((m) => m.key === "credito")).toMatchObject({ avecCents: 10000, avecN: 1, crmCents: 0 });
    expect(e.methods.find((m) => m.key === "credito_cliente")).toMatchObject({ avecCents: -2000 });
    expect(e.methods.find((m) => m.key === "outra:Dívida")).toMatchObject({ label: "Dívida", avecCents: 700 });
    expect(e.methods.map((m) => m.key)).toEqual(["credito", "credito_cliente", "outra:Dívida"]);
    expect(e.crm.entradasCents).toBe(0);
  });

  it("dias sem nada aparecem zerados; período vazio não divide por zero", async () => {
    const e = await financeEntradas({ from: "2026-10-14", to: "2026-10-15", grain: "dia" });
    expect(e.days.map((d) => d.key)).toEqual(["2026-10-14", "2026-10-15"]);
    expect(e.crm).toEqual({ entradasCents: 0, comandas: 0, ticketCents: null, taxasCents: 0, liquidoCents: 0 });
    expect(e.avec).toEqual({ entradasCents: 0, comandas: 0, ticketCents: null, taxasCents: 0, liquidoCents: 0 });
    expect(e.methods).toEqual([]);
    expect(e.cashiers).toEqual([]);
  });
});
