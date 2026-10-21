import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contactStats } from "../db/schema";
import { resetDb } from "../../../test/db";
import { bahia, cliente, setSetting } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { item, payment, pro } from "../../../test/salon-fixtures";
import { openCash } from "../domain/caixa/cash";
import { addItem, addPayment, closeComanda, openWalkInComanda } from "../domain/caixa/comandas";
import { refreshContactStats } from "../domain/contact-stats";
import { revenueTotals, salonByProfessional, salonByService, salonFinance, salonPayments, salonRevenue } from "./salon";
import { salonRange } from "../../lib/salon-period";

/**
 * QA r66, I-1: as vendas fechadas no CRM entram nos relatórios do Salão e no "total gasto" da cliente. Mesma regra "compara, não soma" do
 * Financeiro: no dia em que o caixa do CRM está ligado e há comanda fechada, vale o CRM; senão, o Avec (nunca os dois).
 */
let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

async function venda(day: number, cents: number, o: { contactId?: string; proId?: string } = {}) {
  const at = bahia(day, 10);
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: o.contactId ?? null }, s.caixaRecepcao, at);
  await addItem(w.comandaId, { kind: "produto", label: "Kit CRM", unitCents: cents, professionalId: o.proId ?? null }, s.caixaRecepcao, at);
  await addPayment(w.comandaId, { method: "pix", valueCents: cents }, s.caixaRecepcao, at);
  await closeComanda(w.comandaId, {}, s.caixaRecepcao, at);
}
const R = (from: string, to: string) => ({ from, to });
const NOW = bahia(20, 12);

it("o dia com comanda do CRM vale o CRM; o dia só com Avec vale o Avec; nunca soma os dois", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, bahia(15, 8));
  await item({ day: "2026-10-14", value: 20000, comanda: "7" });                // só Avec
  await payment({ day: "2026-10-14", value: 20000, comanda: "7" });
  await item({ day: "2026-10-15", value: 50000, comanda: "1" });                // Avec no mesmo dia do CRM: não soma
  await payment({ day: "2026-10-15", value: 50000, comanda: "1" });
  await venda(15, 15000);
  const t = await revenueTotals(R("2026-10-14", "2026-10-15"));
  expect(t).toMatchObject({ cents: 35000, comandas: 2 });
  expect(await revenueTotals(R("2026-10-15", "2026-10-15"))).toMatchObject({ cents: 15000, comandas: 1 });
  const f = await salonFinance({ period: "mes", now: NOW });
  expect(f).toMatchObject({ faturadoCents: 35000, comandas: 2, recebidoCents: 35000 });
  expect((await salonPayments(R("2026-10-14", "2026-10-15"))).map((p) => [p.method, p.cents])).toEqual([["Pix", 35000]]);
});

it("serie, ranking por profissional e por serviço enxergam o CRM", async () => {
  const bia = await pro("BIA");
  await openCash({ openingCents: 0 }, s.caixaRecepcao, bahia(15, 8));
  await venda(15, 15000, { proId: bia });
  const rg = salonRange({ periodo: "mes" }, NOW);
  const rev = await salonRevenue(rg);
  expect(rev.cents).toBe(15000);
  expect(rev.series.find((x) => x.key === "2026-10-15")).toMatchObject({ cents: 15000, comandas: 1 });
  expect((await salonByProfessional(R("2026-10-01", "2026-10-31"))).find((p) => p.name === "BIA")).toMatchObject({ cents: 15000, comandas: 1 });
  expect((await salonByService(R("2026-10-01", "2026-10-31"))).items[0]).toMatchObject({ item: "Kit CRM", n: 1, cents: 15000 });
});

it("com o caixa no Avec, comanda do CRM não conta (o Avec é a fonte)", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, bahia(15, 8));
  await venda(15, 15000);
  await item({ day: "2026-10-15", value: 50000 });
  await setSetting("caixa_modo", "avec");
  expect(await revenueTotals(R("2026-10-15", "2026-10-15"))).toMatchObject({ cents: 50000, comandas: 1 });
});

it("total gasto e tickets da cliente somam o Avec dos outros dias e o CRM", async () => {
  const c = await cliente("Paula Souza");
  await openCash({ openingCents: 0 }, s.caixaRecepcao, bahia(15, 8));
  await item({ day: "2026-10-10", value: 20000, comanda: "3", contactId: c.contactId });
  await item({ day: "2026-10-15", value: 50000, comanda: "1", contactId: c.contactId }); // mesmo dia do CRM: vale o CRM
  await venda(15, 15000, { contactId: c.contactId });
  await refreshContactStats({ now: NOW });
  const [st] = await db.select().from(contactStats).where(eq(contactStats.contactId, c.contactId));
  expect(Number(st.totalCents)).toBe(35000);
  expect(st.tickets).toBe(2);
});
