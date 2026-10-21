import { beforeEach, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaItems, comandas, lists, professionals, professionalServices } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { updateService } from "../services";
import { saveCommissionRules, setAssistantCommission } from "./commission-rules";
import { savePaymentFee } from "./payment-fees";
import { applyCommissionToCategory, commissionReport, listCommissionRules, setCommission } from "./commission";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });
const bpOf = async (pro: string, svc: string) => (await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, pro), eq(professionalServices.serviceId, svc))))[0]?.commissionBp ?? null;

it("regra por profissional e serviço; só nos serviços que ela faz; aplicar à categoria; tudo auditado", async () => {
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
  expect(await bpOf(s.ana.id, s.corte.id)).toBe(4000);
  const [manicure] = await db.insert(lists).values({ kind: "service", label: "Manicure", category: "Unhas", position: 99 }).returning();
  await expect(setCommission({ professionalId: s.ana.id, serviceId: manicure.id, bp: 3000 }, s.caixaGestao)).rejects.toThrow("Ela não faz esse serviço: marque em Profissionais primeiro.");
  await expect(setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 10001 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
  expect(await applyCommissionToCategory({ professionalId: s.bia.id, category: "Cabelo", bp: 3500 }, s.caixaGestao)).toEqual({ updated: 3 });
  await expect(applyCommissionToCategory({ professionalId: s.bia.id, category: "Unhas", bp: 3500 }, s.caixaGestao)).rejects.toThrow("Ela não faz nenhum serviço de Unhas.");
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: null }, s.caixaGestao); // apagar volta a "sem regra"
  expect(await bpOf(s.ana.id, s.corte.id)).toBeNull();
  expect((await listCommissionRules()).find((r) => r.name === "Bia")!.services.map((x) => [x.label, x.bp])).toEqual([["Corte", 3500], ["Hidratação", 3500], ["Mechas", 3500]]);
  expect(await db.select().from(auditLog).where(eq(auditLog.action, "comissao_regra"))).toHaveLength(3);
});

it("relatório do período: por profissional, base, % e valor; 'sem regra' e 'valor da sessão não definido' à parte; cancelada fora; desativada continua", async () => {
  const comanda = async (day: string, number: number, status = "fechada") =>
    (await db.insert(comandas).values({ day, number, status, clientName: "Paula Souza", openedBy: s.cati.id, closedBy: s.cati.id }).returning())[0];
  const item = (comandaId: string, over: Partial<typeof comandaItems.$inferInsert>) =>
    db.insert(comandaItems).values({ comandaId, kind: "servico", label: "Corte", qty: 1, unitCents: 12000, professionalId: s.ana.id, serviceId: s.corte.id, ...over });
  const c1 = await comanda("2026-10-10", 1);
  await item(c1.id, { commissionBp: 4000, commissionBaseCents: 12000, commissionCents: 4800 });
  await item(c1.id, { label: "Hidratação", professionalId: s.bia.id, commissionBaseCents: 9000, commissionBp: null, commissionCents: null });
  await item(c1.id, { kind: "pacote_sessao", label: "Corte (pacote)", unitCents: 0, commissionBaseCents: null, commissionBp: 4000, commissionCents: null });
  await item(c1.id, { kind: "produto", label: "Shampoo", professionalId: s.ana.id, unitCents: 4000 }); // produto não tem comissão
  const c2 = await comanda("2026-10-11", 1, "cancelada");
  await item(c2.id, { commissionBp: 4000, commissionBaseCents: 12000, commissionCents: 4800 });
  const c3 = await comanda("2026-11-02", 1);
  await item(c3.id, { commissionBp: 4000, commissionBaseCents: 12000, commissionCents: 4800 }); // fora do período
  await db.update(professionals).set({ active: false }).where(eq(professionals.id, s.bia.id));

  const r = await commissionReport({ from: "2026-10-01", to: "2026-10-31" });
  const ana = r.rows.find((x) => x.name === "Ana")!;
  expect(ana).toMatchObject({ baseCents: 12000, commissionCents: 4800, pending: 1 });
  expect(ana.lines.map((l) => [l.label, l.status])).toEqual([["Corte", "ok"], ["Corte (pacote)", "sem_valor_sessao"]]);
  expect(r.rows.find((x) => x.name === "Bia")).toMatchObject({ active: false, pending: 1, lines: [expect.objectContaining({ label: "Hidratação", status: "sem_regra", baseCents: 9000 })] });
  expect(r.pending).toBe(2);
  expect((await commissionReport({ from: "2026-10-01", to: "2026-10-31", professionalId: s.bia.id })).rows.map((x) => x.name)).toEqual(["Bia"]);
});

it("Fase A: a linha da Ana traz bruta e descontos; a assistente aparece na Sidney com o nome da principal", async () => {
  const [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
  await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
  await updateService(s.corte.id, { costCents: 1000 }, s.gestora.id);
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao);
  await saveCommissionRules({ cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" }, s.caixaGestao);
  await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }], pays: [{ method: "credito", valueCents: 20000, brand: "visa" }] });

  const r = await commissionReport({ from: "2026-10-01", to: "2026-10-31" });
  expect(r.rows.map((x) => [x.name, x.commissionCents])).toEqual([["Ana", 4435], ["Sidney", 1811]]);
  expect(r.rows[0].lines[0]).toMatchObject({ role: "principal", principalName: null, label: "Corte", baseCents: 20000, bp: 4000, grossCents: 8000,
    deductions: { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, commissionCents: 4435, status: "ok", payoutNumber: null });
  expect(r.rows[1]).toMatchObject({ professionalId: sidney.id, baseCents: 18114, pending: 0 });
  expect(r.rows[1].lines).toEqual([expect.objectContaining({ role: "assistente", principalName: "Ana", label: "Corte (assistente de Ana)", kind: "servico",
    baseCents: 18114, bp: 1000, commissionCents: 1811, grossCents: null, deductions: null, status: "ok", payoutNumber: null })]);
  // Só a Sidney: a linha dela vem sozinha.
  expect((await commissionReport({ from: "2026-10-01", to: "2026-10-31", professionalId: sidney.id })).rows.map((x) => [x.name, x.lines.length])).toEqual([["Sidney", 1]]);
});

it("ordem dos itens da comanda pelo instante exato (microssegundos), não pelo milissegundo nem pela ordem física das linhas", async () => {
  // O pro-earnings.test falhava às vezes: dois itens inseridos no mesmo milissegundo empatavam e a ordem vinha da tabela.
  const [c] = await db.insert(comandas).values({ day: "2026-10-10", number: 1, status: "fechada", clientName: "Paula Souza", openedBy: s.cati.id, closedBy: s.cati.id }).returning();
  const item = (label: string, at: string) => db.insert(comandaItems).values({ comandaId: c.id, kind: "servico", label, qty: 1, unitCents: 12000, professionalId: s.ana.id,
    serviceId: s.corte.id, commissionBp: 4000, commissionBaseCents: 12000, commissionCents: 4800, createdAt: new Date(at) });
  // Gravados ao contrário da ordem em que foram somados, no mesmo milissegundo (o Date do JS não guarda microssegundo: ajusta pelo SQL).
  await item("Segundo", "2026-10-10T13:00:00.000Z");
  await item("Primeiro", "2026-10-10T13:00:00.000Z");
  await db.execute(sql`update comanda_items set created_at = created_at + interval '200 microseconds' where label = 'Segundo'`);
  await db.execute(sql`update comanda_items set created_at = created_at + interval '100 microseconds' where label = 'Primeiro'`);
  const rep = await commissionReport({ from: "2026-10-01", to: "2026-10-31" });
  expect(rep.rows.find((r) => r.name === "Ana")!.lines.map((l) => l.label)).toEqual(["Primeiro", "Segundo"]);
});
