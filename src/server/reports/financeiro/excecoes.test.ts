import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, cashMovements } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { item } from "../../../../test/salon-fixtures";
import { caixa, comanda } from "../../../../test/financeiro-fixtures";
import { bahia } from "../../../../test/agenda-fixtures";
import { closeCash, openCash, reopenCash } from "../../domain/caixa/cash";
import { EXCEPTION_LABEL, exceptionCounts, financeExceptions } from "./excecoes";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const DIA = { from: "2026-10-15", to: "2026-10-15" };
const only = async (kind: string) => (await financeExceptions(DIA)).filter((e) => e.kind === kind);

describe("Financeiro: exceções", () => {
  it("desconto no item: quem lançou, sem motivo quando não há auditoria", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Paula", items: [{ label: "Hidratação", unitCents: 9000, discountCents: 1000, serviceId: s.hidratacao.id }] });
    expect(await only("desconto_item")).toEqual([expect.objectContaining({ origin: "crm", item: "Hidratação", client: "Paula", who: "Cati", valueCents: 1000, beforeCents: 9000, afterCents: 8000, reason: null })]);
  });

  it("com auditoria do item (plano 3), quem fez e o motivo vêm dela", async () => {
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Hidratação", unitCents: 9000, discountCents: 1000, serviceId: s.hidratacao.id }] });
    await db.insert(auditLog).values({ userId: s.gestora.id, action: "item_desconto", entity: "comanda_item", entityId: c.items[0].id, data: { motivo: "cliente antiga" } });
    expect(await only("desconto_item")).toEqual([expect.objectContaining({ who: "Thaíse Fiaes", reason: "cliente antiga" })]);
  });

  it("preço alterado: unitário diferente do preço do horário ou, sem horário, do catálogo", async () => {
    const [a] = await db.insert(appointments).values({ serviceLabel: "Hidratação", startsAt: new Date("2026-10-15T13:00:00Z"), status: "compareceu", origin: "crm", externalKey: "t:a1", priceCents: 9500 }).returning();
    await comanda({ day: "2026-10-15", by: s.cati.id, items: [
      { label: "Corte", unitCents: 10000, serviceId: s.corte.id },
      { label: "Corte", unitCents: 12000, serviceId: s.corte.id },
    ] });
    const c2 = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Hidratação", unitCents: 9500, serviceId: s.hidratacao.id }] });
    await db.execute(sql`update comanda_items set appointment_id = ${a.id} where id = ${c2.items[0].id}`);
    expect(await only("preco_alterado")).toEqual([expect.objectContaining({ item: "Corte", beforeCents: 12000, afterCents: 10000, who: "Cati" })]);
  });

  it("cortesia, desconto da comanda, item cancelado, comanda cancelada, reaberta e sangria", async () => {
    await comanda({ day: "2026-10-15", by: s.cati.id, discountCents: 500, pays: [{ method: "cortesia", valueCents: 3000 }],
      items: [{ label: "Corte", unitCents: 12000, serviceId: s.corte.id }, { label: "Escova", unitCents: 5000, cancelled: true }] });
    await comanda({ day: "2026-10-15", by: s.cati.id, status: "cancelada", cancelReason: "duplicada", cancelledBy: s.gestora.id, items: [{ label: "Corte", unitCents: 12000, serviceId: s.corte.id, cancelled: true }] });
    const old = await comanda({ day: "2026-10-15", by: s.cati.id, status: "cancelada", cancelReason: "forma errada", cancelledBy: s.gestora.id });
    await db.insert(auditLog).values({ userId: s.gestora.id, action: "comanda_reaberta_para_corrigir", entity: "comanda", entityId: "x", data: { de: old.id } });
    const cx = await caixa({ day: "2026-10-15", by: s.cati.id });
    await db.insert(cashMovements).values({ cashSessionId: cx.id, kind: "sangria", valueCents: 20000, reason: "banco", createdBy: s.cati.id, createdAt: new Date("2026-10-15T18:00:00Z") });
    const all = await financeExceptions(DIA);
    const by = (k: string) => all.filter((e) => e.kind === k);
    expect(by("cortesia")).toEqual([expect.objectContaining({ valueCents: 3000, who: "Cati" })]);
    expect(by("desconto_comanda")).toEqual([expect.objectContaining({ valueCents: 500, who: "Cati" })]);
    expect(by("item_cancelado")).toEqual([expect.objectContaining({ item: "Escova", valueCents: 5000 })]);
    expect(by("comanda_cancelada")).toEqual([expect.objectContaining({ reason: "duplicada", who: "Thaíse Fiaes" })]);
    expect(by("comanda_reaberta")).toEqual([expect.objectContaining({ reason: "forma errada", comanda: String(old.number) })]);
    expect(by("sangria")).toEqual([expect.objectContaining({ valueCents: 20000, reason: "banco", who: "Cati" })]);
    expect(EXCEPTION_LABEL.comanda_reaberta).toBe("Comanda reaberta para corrigir");
  });

  it("caixa por pessoa (plano 3): motivo do desconto, do preço e do cancelamento pela auditoria da comanda (itemId); estorno, reabertura e contagem recusada", async () => {
    const at = new Date("2026-10-15T17:00:00Z");
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Paula", items: [
      { label: "Hidratação", unitCents: 9000, discountCents: 1000, serviceId: s.hidratacao.id },
      { label: "Corte", unitCents: 10000, serviceId: s.corte.id },
      { label: "Escova", unitCents: 5000, cancelled: true },
    ] });
    const [hid, corte, escova] = c.items;
    const audit = (action: string, data: Record<string, unknown>, entity = "comanda", entityId: string = c.id) =>
      db.insert(auditLog).values({ userId: s.gestora.id, createdAt: at, action, entity, entityId, data });
    await audit("desconto", { numero: c.number, itemId: hid.id, item: "Hidratação", valor: 1000, motivo: "cliente antiga" });
    await audit("preco_alterado", { numero: c.number, itemId: corte.id, item: "Corte", de: 12000, para: 10000, motivo: "promoção" });
    await audit("item_cancelado", { numero: c.number, itemId: escova.id, item: "Escova", valor: 5000, motivo: "lançado errado" });
    await audit("estorno", { numero: c.number, pagamento: "p1", forma: "pix", valor: 4000, motivo: "pix em dobro" });
    await audit("comanda_reaberta", { numero: c.number, motivo: "faltou um item", total: 18000 });
    const cx = await caixa({ day: "2026-10-15", by: s.cati.id, status: "aberto" });
    await audit("caixa_contagem_recusada", { dono: s.cati.id, diferenca: -2500 }, "cash_session", cx.id); // registro antigo, sem as formas
    const all = await financeExceptions(DIA);
    const by = (k: string) => all.filter((e) => e.kind === k);
    expect(by("desconto_item")).toEqual([expect.objectContaining({ item: "Hidratação", who: "Thaíse Fiaes", reason: "cliente antiga" })]);
    expect(by("preco_alterado")).toEqual([expect.objectContaining({ item: "Corte", who: "Thaíse Fiaes", reason: "promoção" })]);
    expect(by("item_cancelado")).toEqual([expect.objectContaining({ item: "Escova", reason: "lançado errado" })]);
    expect(by("desconto_comanda")).toEqual([]); // o desconto do item não vira desconto da comanda
    expect(by("estorno")).toEqual([expect.objectContaining({ origin: "crm", day: "2026-10-15", comanda: String(c.number), who: "Thaíse Fiaes", valueCents: 4000, reason: "pix em dobro" })]);
    expect(by("comanda_reaberta")).toEqual([expect.objectContaining({ comanda: String(c.number), who: "Thaíse Fiaes", valueCents: 18000, reason: "faltou um item" })]);
    expect(by("contagem_recusada")).toEqual([expect.objectContaining({ comanda: null, who: "Thaíse Fiaes", valueCents: -2500 })]);
    expect(EXCEPTION_LABEL.estorno).toBe("Estorno de pagamento");
  });

  it("fechamento (QA r58, I-4): uma linha por forma com diferença e o motivo; as tentativas recusadas não se repetem", async () => {
    const at = (h: number) => bahia(15, h);
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, at(8));
    await comanda({ day: "2026-10-15", by: s.cati.id, cashSessionId: a.id, items: [{ label: "Corte", unitCents: 23000, serviceId: s.corte.id }],
      pays: [{ method: "dinheiro", valueCents: 14000 }, { method: "pix", valueCents: 9000 }] });
    // Esperado: dinheiro 24.000 e Pix 9.000. Contado: dinheiro 14.000 e Pix 19.000. Três tentativas recusadas e a aprovada.
    const input = { cashBreakdown: { "10000": 1, "2000": 2 }, counted: { pix: 19000 }, notes: "Pix lançado no lugar do dinheiro" };
    for (const h of [10, 11, 12]) expect((await closeCash(input, s.caixaRecepcao, at(h))).status).toBe("precisa_aprovacao");
    expect((await closeCash({ ...input, approverId: s.gestora.id }, s.caixaRecepcao, at(13))).status).toBe("fechado");
    // A gestão ainda não fechou o dela: a última tentativa recusada aparece, uma vez por forma.
    await openCash({ openingCents: 5000 }, s.caixaGestao, at(8));
    await closeCash({ cashBreakdown: { "2000": 2 }, counted: {} }, s.caixaGestao, at(14));
    await closeCash({ cashBreakdown: { "2000": 2 }, counted: {}, notes: "faltou o troco do café" }, s.caixaGestao, at(15));
    const all = (await financeExceptions(DIA)).filter((e) => e.kind === "caixa_diferenca" || e.kind === "contagem_recusada");
    expect(all.map((e) => [e.kind, e.client, e.item, e.valueCents, e.reason, e.who])).toEqual([
      ["contagem_recusada", "Caixa de Thaíse Fiaes", "Dinheiro", -1000, "faltou o troco do café", "Thaíse Fiaes"],
      ["caixa_diferenca", "Caixa de Cati", "Dinheiro · aprovada por Thaíse Fiaes", -10000, "Pix lançado no lugar do dinheiro", "Cati"],
      ["caixa_diferenca", "Caixa de Cati", "Pix · aprovada por Thaíse Fiaes", 10000, "Pix lançado no lugar do dinheiro", "Cati"],
    ]);
    expect(EXCEPTION_LABEL.caixa_diferenca).toBe("Diferença no fechamento");
  });

  it("fechamento (revisão): a observação da abertura não vira motivo; reaberto, as recusas de antes do fechamento não voltam", async () => {
    const at = (h: number) => bahia(15, h);
    const a = await openCash({ openingCents: 0, notes: "troco do dia" }, s.caixaRecepcao, at(8));
    const input = { cashBreakdown: { "5000": 1 }, counted: {} }; // 50 a mais
    expect((await closeCash(input, s.caixaRecepcao, at(10))).status).toBe("precisa_aprovacao");
    expect((await closeCash({ ...input, approverId: s.gestora.id }, s.caixaRecepcao, at(11))).status).toBe("fechado");
    let all = (await financeExceptions(DIA)).filter((e) => e.kind === "caixa_diferenca" || e.kind === "contagem_recusada");
    expect(all.map((e) => [e.kind, e.item, e.valueCents, e.reason])).toEqual([["caixa_diferenca", "Dinheiro · aprovada por Thaíse Fiaes", 5000, null]]);
    await reopenCash(a.id, { reason: "estorno de Pix" }, s.caixaGestao, at(12));
    all = (await financeExceptions(DIA)).filter((e) => e.kind === "caixa_diferenca" || e.kind === "contagem_recusada");
    expect(all).toEqual([]);
  });

  it("profissional diferente entre o horário e a comanda fechada, com as duas; igual ou sem horário não entra", async () => {
    const [a] = await db.insert(appointments).values({ serviceLabel: "Corte", startsAt: new Date("2026-10-15T13:00:00Z"), status: "compareceu", origin: "crm", externalKey: "t:p1", professionalId: s.ana.id, priceCents: 10000 }).returning();
    const [b] = await db.insert(appointments).values({ serviceLabel: "Escova", startsAt: new Date("2026-10-15T14:00:00Z"), status: "compareceu", origin: "crm", externalKey: "t:p2", professionalId: s.ana.id, priceCents: 5000 }).returning();
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Paula", items: [
      { label: "Corte", unitCents: 10000, serviceId: s.corte.id, professionalId: s.bia.id },
      { label: "Escova", unitCents: 5000, professionalId: s.ana.id },
      { label: "Hidratação", unitCents: 9000, serviceId: s.hidratacao.id, professionalId: s.bia.id },
    ] });
    await db.execute(sql`update comanda_items set appointment_id = ${a.id} where id = ${c.items[0].id}`);
    await db.execute(sql`update comanda_items set appointment_id = ${b.id} where id = ${c.items[1].id}`);
    expect(await only("profissional_trocada")).toEqual([expect.objectContaining({ item: "Corte", client: "Paula", comanda: String(c.number), reason: "Agenda: Ana · Comanda: Bia" })]);
    expect(EXCEPTION_LABEL.profissional_trocada).toBe("Profissional diferente da agenda");
  });

  it("assistente trocada (do audit) e item cancelado em comanda aberta entram", async () => {
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Rita", status: "aberta", items: [{ label: "Corte", unitCents: 10000, serviceId: s.corte.id }, { label: "Escova", unitCents: 5000, cancelled: true }] });
    await db.insert(auditLog).values({ userId: s.cati.id, createdAt: new Date("2026-10-15T17:00:00Z"), action: "assistente_alterado", entity: "comanda", entityId: c.id,
      data: { numero: c.number, itemId: c.items[0].id, item: "Corte", de: ["Roberta", "Sidney"], para: ["Sidney"] } });
    const all = await financeExceptions(DIA);
    expect(all.filter((x) => x.kind === "assistente_alterado")).toEqual([expect.objectContaining({ reason: "De Roberta, Sidney para Sidney", item: "Corte", comanda: String(c.number), client: "Rita", who: "Cati" })]);
    expect(all.some((x) => x.kind === "item_cancelado" && x.comanda === String(c.number) && x.item === "Escova")).toBe(true);
    expect(EXCEPTION_LABEL.assistente_alterado).toBe("Assistente trocada");
    expect(await financeExceptions({ from: "2026-10-16", to: "2026-10-16" })).toEqual([]);
  });

  it("contagem por tipo para o resumo", async () => {
    const list = await financeExceptions(DIA);
    expect(exceptionCounts(list)).toEqual([]);
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, discountCents: 500, items: [{ label: "Corte", unitCents: 12000, serviceId: s.corte.id }] });
    expect(c.number).toBeGreaterThan(0);
    const counts = exceptionCounts(await financeExceptions(DIA));
    expect(counts).toEqual([{ kind: "desconto_comanda", label: "Desconto na comanda", count: 1 }]);
    expect(exceptionCounts([{ origin: "crm", kind: "sangria", day: "d", at: null, comanda: null, client: null, item: null, who: null, beforeCents: null, afterCents: null, valueCents: 1, reason: null }, { origin: "crm", kind: "sangria", day: "d", at: null, comanda: null, client: null, item: null, who: null, beforeCents: null, afterCents: null, valueCents: 1, reason: null }]))
      .toEqual([{ kind: "sangria", label: "Sangria", count: 2 }]);
  });

  it("Avec: desconto e item a R$ 0 (sessão de pacote não conta); comanda aberta do CRM não entra", async () => {
    await item({ day: "2026-10-15", item: "Escova", value: 10000, discount: 2000, clientName: "Rita" });
    await item({ day: "2026-10-15", item: "Terapia", value: 0, total: 0 });
    await item({ day: "2026-10-15", item: "Sessão", value: 0, total: 0, fromPackage: true });
    await comanda({ day: "2026-10-15", by: s.cati.id, status: "aberta", discountCents: 900, items: [{ label: "Corte", unitCents: 1, serviceId: s.corte.id, discountCents: 1 }] });
    const all = await financeExceptions(DIA);
    expect(all.map((e) => e.kind).sort()).toEqual(["desconto_avec", "zero_avec"]);
    expect(all.find((e) => e.kind === "desconto_avec")).toMatchObject({ origin: "avec", item: "Escova", client: "Rita", valueCents: 2000, who: null });
  });
});
