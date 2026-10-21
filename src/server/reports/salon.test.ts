import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { avecUntil, salonByProfessional, salonByService, salonPayments, salonRevenue, yearlyCheck } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW); // setembro/2026; anterior: agosto

beforeEach(resetDb);

describe("Salão: dinheiro", () => {
  it("faturamento: valor − desconto, comanda pelo par dia+número, sem sessão de pacote, com o período anterior e barras sem buraco", async () => {
    await item({ day: "2026-09-02", comanda: "10", value: 30000, discount: 5000 });
    await item({ day: "2026-09-02", comanda: "10", item: "Escova", value: 10000 });
    await item({ day: "2026-09-03", comanda: "10", value: 20000 });                 // mesmo número, outro dia: outra comanda
    await item({ day: "2026-09-04", comanda: null, value: 5000 });                  // sem número: comanda própria
    await item({ day: "2026-09-05", comanda: "11", value: 40000, fromPackage: true }); // sessão de pacote: não é dinheiro novo
    await item({ day: "2026-09-06", comanda: "12", value: 8000, discount: 1000, total: null }); // linha antiga sem total: valor − desconto
    await item({ day: "2026-08-20", comanda: "3", value: 12000 });
    const r = await salonRevenue(SET);
    expect(r).toMatchObject({ cents: 67000, comandas: 4, ticketCents: 16750 });
    expect(r.previous).toMatchObject({ cents: 12000, comandas: 1 });
    expect(r.series).toHaveLength(30);
    expect(r.series[0]).toEqual({ key: "2026-09-01", cents: 0, comandas: 0 });
    expect(r.series.find((s) => s.key === "2026-09-02")).toEqual({ key: "2026-09-02", cents: 35000, comandas: 1 });
  });

  it("'fonte: Avec até': a última venda vinda do Avec (comanda do CRM não conta)", async () => {
    expect(await avecUntil()).toBeNull();
    await item({ day: "2026-10-14", value: 1000 });
    await item({ day: "2026-10-15", value: 1000, origin: "crm" });
    expect(await avecUntil()).toBe("2026-10-14");
  });

  it("por profissional: nome do cadastro, senão o nome escrito no Avec, senão 'Sem profissional'; comissão só quando existe", async () => {
    const maiara = await pro("MAIARA");
    await item({ day: "2026-09-02", comanda: "1", proId: maiara, value: 30000, commissionPct: 40, commissionCents: 12000 });
    await item({ day: "2026-09-02", comanda: "1", proId: maiara, item: "Escova", value: 10000 });
    await item({ day: "2026-09-03", comanda: "2", proName: "JO", value: 8000 });
    await item({ day: "2026-09-03", comanda: "3", value: 2000 });
    const rows = await salonByProfessional(SET);
    expect(rows.map((r) => [r.name, r.cents, r.comandas, r.ticketCents, r.commissionCents])).toEqual([
      ["MAIARA", 40000, 1, 40000, 12000], ["JO", 8000, 1, 8000, null], ["Sem profissional", 2000, 1, 2000, null],
    ]);
  });

  it("por serviço (os 15 maiores e o resto somado) e por categoria ('Sem categoria' quando falta)", async () => {
    for (let i = 0; i < 17; i++) {
      await item({ day: "2026-09-10", comanda: String(100 + i), item: `Serviço ${String(i).padStart(2, "0")}`, value: 1000 * (i + 1), category: i % 2 ? "CABELO" : null });
    }
    const s = await salonByService(SET);
    expect(s.items).toHaveLength(15);
    expect(s.items[0]).toMatchObject({ item: "Serviço 16", n: 1, cents: 17000 });
    expect(s.otherItems).toEqual({ count: 2, n: 2, cents: 3000 });
    expect(s.categories.map((c) => c.category).sort()).toEqual(["CABELO", "Sem categoria"]);
  });

  it("formas de pagamento: a bandeira não separa ('Cartão de Crédito (Visa)' e '(Master)' viram uma) e vale a data do pagamento", async () => {
    await payment({ day: "2026-09-02", value: 10000, method: "Cartão de Crédito (Visa)" });
    await payment({ day: "2026-09-02", value: 5000, method: "Cartão de Crédito (Master)" });
    await payment({ day: "2026-09-03", value: 7000, method: "Pix" });
    await payment({ day: "2026-08-31", paidOn: "2026-09-01", value: 1000, method: null }); // comanda de agosto paga em setembro
    expect(await salonPayments(SET)).toEqual([
      { method: "Cartão de Crédito", n: 2, cents: 15000 }, { method: "Pix", n: 1, cents: 7000 }, { method: "Não informada", n: 1, cents: 1000 },
    ]);
  });

  it("conferência por ano: com e sem as sessões de pacote contra os pagamentos, com a diferença em %", async () => {
    await item({ day: "2025-03-01", value: 100000 });
    await item({ day: "2025-03-02", value: 5000, fromPackage: true });
    await payment({ day: "2025-03-01", value: 96000 });
    expect(await yearlyCheck()).toEqual([{ ano: 2025, faturamentoCents: 100000, comPacoteCents: 105000, pagamentosCents: 96000, diferencaPct: 4.2 }]);
  });
});
