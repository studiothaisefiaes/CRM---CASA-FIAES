import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import { clientPackages, packageUses } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { item } from "../../../../test/salon-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { commissionReport } from "../../domain/caixa/commission";
import { crmItems, financeItens } from "./itens";
import { professionals } from "../../db/schema";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { setCommission } from "../../domain/caixa/commission";
import { setAssistantCommission } from "../../domain/caixa/commission-rules";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const DIA = { from: "2026-10-15", to: "2026-10-15" };

describe("Financeiro: itens", () => {
  it("a assistente aparece em Por profissional com a comissão dela, e a soma das pessoas bate com 'Comissão no CRM'", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
    await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }], pays: [{ method: "pix", valueCents: 20000 }] });
    const f = await financeItens({ from: "2026-10-01", to: "2026-10-31" });
    const sid = f.professionals.find((p) => p.key === sidney.id);
    expect(sid?.crmCommissionCents).toBeGreaterThan(0);
    expect(f.professionals.reduce((t, p) => t + (p.crmCommissionCents ?? 0), 0)).toBe(f.commission.crmCents);
  });

  it("cortesia (QA r58, C-3) fica fora do faturamento por profissional, serviço e categoria; a parcial tira só a parte rateada", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, pays: [{ method: "cortesia", valueCents: 6000 }],
      items: [{ label: "Escova", unitCents: 6000, professionalId: s.bia.id, serviceId: s.hidratacao.id }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, pays: [{ method: "cortesia", valueCents: 7000 }, { method: "pix", valueCents: 14000 }], items: [
      { label: "Corte", unitCents: 12000, professionalId: s.ana.id, serviceId: s.corte.id },
      { label: "Hidratação", unitCents: 9000, professionalId: s.bia.id, serviceId: s.hidratacao.id },
    ] });
    const f = await financeItens(DIA);
    expect(f.professionals.map((p) => [p.name, p.crmCents, p.crmItens])).toEqual([["Ana", 8000, 1], ["Bia", 6000, 1]]);
    expect(f.services.map((x) => [x.label, x.crmCents, x.crmN])).toEqual([["Corte", 8000, 1], ["Hidratação", 6000, 1]]);
    expect(f.categories.reduce((t, c) => t + c.crmCents, 0)).toBe(14000);
  });


  it("CRM: valor do item menos a parte dele no desconto da comanda; item cancelado e comanda aberta fora", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, discountCents: 2000, items: [
      { label: "Corte", unitCents: 12000, professionalId: s.ana.id, serviceId: s.corte.id },
      { label: "Hidratação", unitCents: 9000, discountCents: 1000, professionalId: s.bia.id, serviceId: s.hidratacao.id },
      { label: "Corte", unitCents: 5000, professionalId: s.ana.id, serviceId: s.corte.id, cancelled: true },
    ] });
    await comanda({ day: "2026-10-15", by: s.cati.id, status: "aberta", items: [{ label: "Corte", unitCents: 12000, professionalId: s.ana.id }] });
    const items = await crmItems(DIA);
    expect(items.map((i) => [i.item, i.netCents])).toEqual([["Corte", 10800], ["Hidratação", 7200]]);
    const f = await financeItens(DIA);
    expect(f.professionals.find((p) => p.name === "Ana")).toMatchObject({ crmCents: 10800, crmItens: 1, avecCents: 0 });
    expect(f.professionals.find((p) => p.name === "Bia")).toMatchObject({ crmCents: 7200 });
    expect(f.categories.find((c) => c.label === "Cabelo")).toMatchObject({ crmN: 2, crmCents: 18000 });
  });

  it("Avec: profissional pelo nome escrito, comissão do Avec, serviço e categoria juntam com o CRM pelo nome", async () => {
    await item({ day: "2026-10-15", proName: "MAIARA TESTE", item: "CORTE", category: "CABELO", value: 25000, commissionCents: 10000 });
    await item({ day: "2026-10-15", item: "Pacote sessão", value: 9000, fromPackage: true });
    await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Corte", unitCents: 12000, professionalId: s.ana.id, serviceId: s.corte.id }] });
    const f = await financeItens(DIA);
    expect(f.professionals.find((p) => p.name === "MAIARA TESTE")).toMatchObject({ avecCents: 25000, avecItens: 1, avecCommissionCents: 10000, crmCents: 0 });
    expect(f.services.find((x) => x.label === "Corte")).toMatchObject({ crmN: 1, crmCents: 12000, avecN: 1, avecCents: 25000 });
    expect(f.categories.find((x) => x.label === "Cabelo")).toMatchObject({ crmCents: 12000, avecCents: 25000 });
    expect(f.services.find((x) => x.label === "Pacote sessão")).toMatchObject({ avecN: 1, avecCents: 0 });
    expect(f.commission.avecCents).toBe(10000);
  });

  it("pacotes vendidos e sessões usadas, CRM e Avec separados; pacote cancelado fora", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Pacote 4 escovas", kind: "pacote_venda", unitCents: 50000 }] });
    await db.insert(clientPackages).values([
      { packageName: "Pacote Avec", totalSessions: 4, priceCents: 30000, purchasedOn: "2026-10-15", origin: "avec", externalKey: "t:p1" },
      { packageName: "Pacote Avec", totalSessions: 4, priceCents: 30000, purchasedOn: "2026-10-15", origin: "avec", externalKey: "t:p2", cancelledAt: new Date() },
    ]);
    await db.insert(packageUses).values([
      { usedOn: "2026-10-15", item: "Escova", origin: "avec", externalKey: "t:u1" },
      { usedOn: "2026-10-14", item: "Escova", origin: "avec", externalKey: "t:u2" },
    ]);
    const { packages } = await financeItens(DIA);
    expect(packages.crm).toEqual({ vendidos: 1, cents: 50000, sessoes: 0 });
    expect(packages.avec).toEqual({ vendidos: 1, cents: 30000, sessoes: 1 });
    expect(packages.byName).toEqual(expect.arrayContaining([{ name: "Pacote 4 escovas", crm: 1, avec: 0 }, { name: "Pacote Avec", crm: 0, avec: 1 }]));
  });

  it("comissão do CRM = a do relatório de Comissão (só linhas com regra); período vazio sem NaN", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, items: [
      { label: "Corte", unitCents: 12000, professionalId: s.ana.id, serviceId: s.corte.id, commissionBp: 4000, commissionBaseCents: 12000, commissionCents: 4800 },
      { label: "Hidratação", unitCents: 9000, professionalId: s.bia.id, serviceId: s.hidratacao.id },
    ] });
    const rep = await commissionReport(DIA);
    const f = await financeItens(DIA);
    expect(f.commission).toEqual({ crmCents: rep.rows.reduce((a, r) => a + r.commissionCents, 0), crmPending: rep.pending, avecCents: null });
    expect(f.commission.crmCents).toBe(4800);
    expect(f.commission.crmPending).toBe(1);
    const empty = await financeItens({ from: "2026-01-01", to: "2026-01-02" });
    expect(empty).toMatchObject({ professionals: [], services: [], categories: [], commission: { crmCents: 0, crmPending: 0, avecCents: null } });
  });
});
