import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, auditLog, clientPackages, comandaItems, comandaPayments, comandas, contacts, lists, loyaltyEntries, loyaltyPrograms, professionalServices } from "../db/schema";
import { resetDb } from "../../../test/db";
import { bahia, cliente, NOW, setSetting } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { saveCaixaRules } from "./caixa/mode";
import {
  addItem, addPayment, ApprovalNeededError, openComandaForAppointment, cancelComanda, closeComanda, discardComanda, openWalkInComanda, removeItem, reopenComanda, reopenForCorrection,
  setComandaClient, setComandaDiscount, updateItem, type AddItemInput,
} from "./caixa/comandas";
import { saveFuncoes } from "./funcoes";
import { loyaltyOf, redeemLoyalty } from "./fidelidade";
import { cancelAppointments, createVisit } from "./agenda/visits";

let s: Awaited<ReturnType<typeof setupCaixa>>;
let fin: typeof lists.$inferSelect, ritual: typeof lists.$inferSelect;
let fiel: string, dez: string, aniv: string;

beforeEach(async () => {
  await resetDb();
  s = await setupCaixa();
  [fin, ritual] = await db.insert(lists).values([
    { kind: "service", label: "Finalização simples", category: "Finalização", priceCents: 8000, durationMin: 30, position: 91 },
    { kind: "service", label: "Ritual de tratamento", category: "Tratamento", priceCents: 20000, durationMin: 60, position: 92 },
  ]).returning();
  await db.insert(professionalServices).values([fin, ritual].map((x) => ({ professionalId: s.ana.id, serviceId: x.id })));
  [fiel, dez, aniv] = (await db.insert(loyaltyPrograms).values([
    { name: "Fiel da Fiaes", kind: "contagem", goal: 12, countsServiceIds: null, rewardServiceIds: [fin.id], maxDiscountBp: 2000, position: 0 },
    { name: "10x Você", kind: "contagem", goal: 10, countsServiceIds: [s.corte.id], rewardServiceIds: [s.corte.id], maxDiscountBp: 2000, position: 1, description: "Acompanhe pelo nosso sistema" },
    { name: "Aniversário", kind: "aniversario", goal: null, rewardServiceIds: [ritual.id], rewardDiscountBp: 5000, position: 2 },
  ]).returning()).map((p) => p.id);
});

const corte = (o: Partial<AddItemInput> = {}): AddItemInput => ({ kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, ...o });
const hidratacao = (): AddItemInput => ({ kind: "servico", serviceId: s.hidratacao.id, professionalId: s.bia.id });

async function aberta(contactId: string | null, items: AddItemInput[] = []) {
  const { comandaId } = await openWalkInComanda({ contactId, requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  for (const it of items) await addItem(comandaId, it, s.caixaRecepcao, NOW);
  return comandaId;
}
/** Paga o que falta em Pix e fecha. */
async function fechar(comandaId: string, now = NOW) {
  const items = await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt)));
  const [c] = await db.select().from(comandas).where(eq(comandas.id, comandaId));
  const paid = (await db.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, comandaId), isNull(comandaPayments.cancelledAt)))).reduce((a, p) => a + p.valueCents, 0);
  const total = items.reduce((a, i) => a + Math.max(0, Math.round(Number(i.qty) * (i.unitCents ?? 0)) - i.discountCents), 0) - c.discountCents - paid;
  if (total > 0) await addPayment(comandaId, { method: "pix", valueCents: total }, s.caixaRecepcao, now);
  await closeComanda(comandaId, {}, s.caixaRecepcao, now);
}
const status = async (contactId: string, programId: string, now = NOW) => (await loyaltyOf(contactId, now)).find((p) => p.programId === programId)!;
const saldo = async (contactId: string, programId = fiel) => (await status(contactId, programId)).balance;
const pontos = (contactId: string, programId: string, delta: number) =>
  db.insert(loyaltyEntries).values({ contactId, programId, delta, reason: "ajuste", createdBy: s.gestora.id });
const aprovacao = (bp: number | null) => saveCaixaRules({ toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: bp }, s.gestora.id);
/** Horário marcado pela Agenda e a comanda aberta dele (a visita é em `day` de outubro). */
async function horario(contactId: string, serviceId: string, day = 15) {
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId }, startsAt: bahia(day, 10).toISOString(), items: [{ serviceId, professionalId: s.ana.id, preference: "escolhida" as const }] }, s.recepcao, bahia(15, 8));
  return { appointmentId: v.appointmentIds[0], open: () => openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW) };
}
const itemOf = async (id: string) => (await db.select().from(comandaItems).where(eq(comandaItems.id, id)))[0];

describe("pontos", () => {
  it("fechar comanda dá 1 ponto por serviço que conta; reabrir e fechar de novo não duplica", async () => {
    const p = await cliente("Paula Souza");
    await setSetting("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }); // produto em texto livre
    const c = await aberta(p.contactId, [corte(), hidratacao(), { kind: "produto", label: "Shampoo", unitCents: 4000 }]);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(2); // Fiel: todos os serviços; o produto não conta
    expect(await saldo(p.contactId, dez)).toBe(1); // 10x Você: só o Corte
    await reopenComanda(c, { reason: "faltou um item" }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(0); // aberta de novo: os pontos saem até fechar
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(2);
    expect(await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.programId, fiel))).toHaveLength(2);
    // Sem cliente (balcão) não pontua.
    await fechar(await aberta(null, [corte()]));
    expect(await db.select().from(loyaltyEntries)).toHaveLength(3);
  });

  it("cada item vale a quantidade", async () => {
    const p = await cliente("Paula Souza");
    await fechar(await aberta(p.contactId, [corte({ qty: 3 })]));
    expect(await saldo(p.contactId)).toBe(3);
  });

  it("cancelar a comanda tira os pontos", async () => {
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId, [corte(), hidratacao()]);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(2);
    await cancelComanda(c, { reason: "lançada errado" }, s.caixaGestao, NOW);
    expect(await saldo(p.contactId)).toBe(0);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "fidelidade_estornada")))[0]).toMatchObject({ entityId: c, userId: s.gestora.id });
  });

  it("reabrir para corrigir tira os pontos da antiga; a nova pontua ao fechar", async () => {
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId, [corte()]);
    await fechar(c);
    const n = await reopenForCorrection(c, { reason: "profissional errada" }, s.caixaGestao, NOW);
    expect(await saldo(p.contactId)).toBe(0);
    await fechar(n.comandaId);
    expect(await saldo(p.contactId)).toBe(1);
  });

  it("desconto acima de 20% não pontua (max_discount_bp 2000); 20% pontua", async () => {
    const p = await cliente("Paula Souza");
    await fechar(await aberta(p.contactId, [corte({ discountCents: 2401, reason: "cliente antiga" })])); // 20,01% de 12.000
    expect(await saldo(p.contactId)).toBe(0);
    await fechar(await aberta(p.contactId, [corte({ discountPercent: 20, reason: "cliente antiga" })]));
    expect(await saldo(p.contactId)).toBe(1);
  });

  it("o desconto na comanda inteira também conta para o limite", async () => {
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId, [corte()]);
    await db.update(comandas).set({ discountCents: 3000, discountReason: "aniversário" }).where(eq(comandas.id, c)); // 25%
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(0);
  });

  it("preço baixado conta como desconto: de 120 para 50 não pontua; 20% exatos (96) pontuam; preço 0 não pontua", async () => {
    const p = await cliente("Paula Souza");
    await fechar(await aberta(p.contactId, [corte({ unitCents: 5000, reason: "promoção" })]));
    expect(await saldo(p.contactId)).toBe(0);
    await fechar(await aberta(p.contactId, [corte({ unitCents: 0, reason: "teste de modelo" })]));
    expect(await saldo(p.contactId)).toBe(0);
    await fechar(await aberta(p.contactId, [corte({ unitCents: 9600, reason: "promoção" })]));
    expect(await saldo(p.contactId)).toBe(1);
    // Baixar o preço depois (updateItem) também conta.
    const c = await aberta(p.contactId, [corte()]);
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c));
    await updateItem(it.id, { unitCents: 5000, reason: "promoção" }, s.caixaRecepcao, NOW);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(1);
  });

  it("horário de preço 0 (Avec com R$ 0,00) cobrado a 150 pontua: 0 é 'sem tabela'", async () => {
    const p = await cliente("Paula Souza");
    const h = await horario(p.contactId, s.corte.id);
    await db.update(appointments).set({ priceCents: 0 }).where(eq(appointments.id, h.appointmentId));
    const { comandaId } = await h.open();
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId));
    expect(it).toMatchObject({ unitCents: 0, originalUnitCents: 0 });
    await updateItem(it.id, { unitCents: 15000, reason: "preço do dia" }, s.caixaRecepcao, NOW);
    await fechar(comandaId);
    expect(await saldo(p.contactId)).toBe(1);
  });

  it("cortesia conta como desconto: a comanda toda em cortesia não pontua", async () => {
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId, [corte()]);
    await addPayment(c, { method: "cortesia", valueCents: 12000, note: "aniversário" }, s.caixaRecepcao, NOW);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(0);
    // Parte em cortesia: o rateio entra no limite (2.000 de 12.000 = 16,7%: pontua).
    const d = await aberta(p.contactId, [corte()]);
    await addPayment(d, { method: "cortesia", valueCents: 2000, note: "retoque" }, s.caixaRecepcao, NOW);
    await fechar(d);
    expect(await saldo(p.contactId)).toBe(1);
  });

  it("função desligada: reabrir não tira os pontos já somados; reabrir para corrigir leva os pontos para a comanda nova; tirar o item tira", async () => {
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId, [corte()]);
    await fechar(c);
    await saveFuncoes({ fidelidade: false }, s.gestora.id);
    await reopenComanda(c, { reason: "conferir" }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(1);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(1);
    const n = await reopenForCorrection(c, { reason: "profissional errada" }, s.caixaGestao, NOW);
    expect(await saldo(p.contactId)).toBe(1);
    const [novo] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, n.comandaId));
    expect((await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.programId, fiel)))[0]).toMatchObject({ reason: "servico", comandaId: n.comandaId, comandaItemId: novo.id });
    await removeItem(novo.id, {}, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(0);
  });

  it("mudar max_discount_bp muda o que pontua", async () => {
    await db.update(loyaltyPrograms).set({ maxDiscountBp: 3000 }).where(eq(loyaltyPrograms.id, fiel));
    const p = await cliente("Paula Souza");
    await fechar(await aberta(p.contactId, [corte({ discountPercent: 25, reason: "cliente antiga" })]));
    expect(await saldo(p.contactId)).toBe(1);
    expect(await saldo(p.contactId, dez)).toBe(0); // 10x Você continua em 20%
  });

  it("sessão de pacote não pontua; com counts_package_sessions ligado, pontua", async () => {
    const p = await cliente("Paula Souza");
    const [cp] = await db.insert(clientPackages).values({ contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 0, externalKey: "avec:pac:1" }).returning();
    const sessao: AddItemInput = { kind: "pacote_sessao", clientPackageId: cp.id, professionalId: s.ana.id };
    await fechar(await aberta(p.contactId, [sessao]));
    expect(await saldo(p.contactId)).toBe(0);
    await db.update(loyaltyPrograms).set({ countsPackageSessions: true }).where(eq(loyaltyPrograms.id, fiel));
    await fechar(await aberta(p.contactId, [sessao]));
    expect(await saldo(p.contactId)).toBe(1);
    expect(await saldo(p.contactId, dez)).toBe(0); // no 10x Você continua desligado
  });

  it("programa inativo não pontua", async () => {
    await db.update(loyaltyPrograms).set({ active: false }).where(eq(loyaltyPrograms.id, dez));
    const p = await cliente("Paula Souza");
    await fechar(await aberta(p.contactId, [corte()]));
    expect(await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.programId, dez))).toHaveLength(0);
    expect((await loyaltyOf(p.contactId, NOW)).map((x) => x.name)).toEqual(["Fiel da Fiaes", "Aniversário"]);
  });

  it("função desligada: fechar não pontua e o prêmio é recusado; cancelar ainda tira o ponto já dado", async () => {
    const p = await cliente("Paula Souza");
    const antes = await aberta(p.contactId, [corte()]);
    await fechar(antes);
    await saveFuncoes({ fidelidade: false }, s.gestora.id);
    await fechar(await aberta(p.contactId, [corte()]));
    expect(await saldo(p.contactId)).toBe(1);
    await pontos(p.contactId, fiel, 20);
    const c = await aberta(p.contactId);
    await expect(redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await cancelComanda(antes, { reason: "lançada errado" }, s.caixaGestao, NOW);
    expect(await saldo(p.contactId)).toBe(20);
  });
});

describe("prêmio da contagem", () => {
  it("com 12 pontos, usar o prêmio põe o item com 100% de desconto e motivo 'Fidelidade: Fiel da Fiaes' sem pedir aprovação, e o saldo vai a 0", async () => {
    await aprovacao(1000);
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    expect(await status(p.contactId, fiel)).toMatchObject({ name: "Fiel da Fiaes", kind: "contagem", goal: 12, balance: 12, ready: true, rewardServiceIds: [fin.id] });
    const c = await aberta(p.contactId);
    const { itemId } = await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    expect(await itemOf(itemId)).toMatchObject({ label: "Finalização simples", unitCents: 8000, discountCents: 8000, discountReason: "Fidelidade: Fiel da Fiaes", professionalId: s.ana.id });
    expect(await status(p.contactId, fiel)).toMatchObject({ balance: 0, ready: false });
    expect((await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.reason, "resgate")))[0]).toMatchObject({ delta: -12, comandaId: c, comandaItemId: itemId, createdBy: s.cati.id });
    // Depois do prêmio, um desconto pequeno em outro item não pede aprovação por causa do prêmio.
    await addItem(c, corte({ discountPercent: 5, reason: "retoque" }), s.caixaRecepcao, NOW);
    await fechar(c);
    expect((await db.select().from(comandas).where(eq(comandas.id, c)))[0].status).toBe("fechada");
  });

  it("o prêmio vale também num item que já está na comanda", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId, [{ kind: "servico", serviceId: fin.id, professionalId: s.ana.id }]);
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c));
    await updateItem(it.id, { discountCents: 500, reason: "retoque" }, s.caixaRecepcao, NOW);
    await expect(redeemLoyalty(c, fiel, { itemId: it.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Esse item já tem desconto. Tire o desconto antes de usar o prêmio.");
    await updateItem(it.id, { discountCents: 0 }, s.caixaRecepcao, NOW);
    expect(await redeemLoyalty(c, fiel, { itemId: it.id }, s.caixaRecepcao, NOW)).toEqual({ itemId: it.id });
    expect(await itemOf(it.id)).toMatchObject({ discountCents: 8000, discountReason: "Fidelidade: Fiel da Fiaes" });
    expect(await saldo(p.contactId)).toBe(0);
  });

  it("tirar o item do prêmio devolve os 12 pontos", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId);
    const { itemId } = await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await removeItem(itemId, { reason: "vai usar outro dia" }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(12);
  });

  it("descartar a comanda ou cancelá-la devolve o prêmio; reabrir e reabrir para corrigir mantêm o prêmio usado", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 24);
    const d = await aberta(p.contactId);
    await redeemLoyalty(d, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await discardComanda(d, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(24);

    const c = await aberta(p.contactId);
    await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await fechar(c);
    await reopenComanda(c, { reason: "conferir" }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(12); // o prêmio continua usado: o item está na comanda
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(12);
    const n = await reopenForCorrection(c, { reason: "profissional errada" }, s.caixaGestao, NOW);
    expect(await saldo(p.contactId)).toBe(12); // o prêmio foi junto para a comanda nova
    const [novo] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, n.comandaId));
    expect((await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.reason, "resgate")))[0]).toMatchObject({ comandaId: n.comandaId, comandaItemId: novo.id });
    expect(novo).toMatchObject({ discountCents: 8000, discountReason: "Fidelidade: Fiel da Fiaes" });
    await removeItem(novo.id, {}, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(24);
  });

  it("cancelar na Agenda o horário que virou prêmio devolve os pontos", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const h = await horario(p.contactId, fin.id);
    const { comandaId } = await h.open();
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId));
    await redeemLoyalty(comandaId, fiel, { itemId: it.id }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(0);
    await cancelAppointments({ appointmentId: h.appointmentId, reason: "cliente_desmarcou" }, s.recepcao, NOW);
    expect((await itemOf(it.id)).cancelledAt).not.toBeNull();
    expect(await saldo(p.contactId)).toBe(12);
  });

  it("função desligada + comanda reaberta: cancelar o horário na Agenda tira o ponto do item", async () => {
    const p = await cliente("Paula Souza");
    const h = await horario(p.contactId, s.corte.id, 16); // amanhã: pago antes, o horário continua marcado
    const { comandaId } = await h.open();
    await fechar(comandaId);
    expect(await saldo(p.contactId)).toBe(1);
    await saveFuncoes({ fidelidade: false }, s.gestora.id);
    await reopenComanda(comandaId, { reason: "a cliente desmarcou" }, s.caixaRecepcao, NOW);
    expect(await saldo(p.contactId)).toBe(1);
    await cancelAppointments({ appointmentId: h.appointmentId, reason: "cliente_desmarcou" }, s.recepcao, NOW);
    expect(await saldo(p.contactId)).toBe(0);
  });

  it("o item do prêmio não pontua", async () => {
    await db.update(loyaltyPrograms).set({ maxDiscountBp: null }).where(eq(loyaltyPrograms.id, fiel)); // sem limite de desconto: só a regra do prêmio segura
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId, [corte()]);
    await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await fechar(c);
    expect(await saldo(p.contactId)).toBe(1); // só o Corte
  });

  it("sem saldo: 'Faltam 3 serviços para o prêmio.'", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 9);
    const c = await aberta(p.contactId);
    await expect(redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Faltam 3 serviços para o prêmio.");
    await pontos(p.contactId, fiel, 2);
    await expect(redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Falta 1 serviço para o prêmio.");
    expect(await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c))).toHaveLength(0);
  });

  it("mudar a meta muda quando fica pronto; mudar o modelo muda o motivo", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 10);
    expect((await status(p.contactId, fiel)).ready).toBe(false);
    await db.update(loyaltyPrograms).set({ goal: 10, rewardReasonTemplate: "Prêmio do {programa}" }).where(eq(loyaltyPrograms.id, fiel));
    expect(await status(p.contactId, fiel)).toMatchObject({ goal: 10, ready: true });
    const c = await aberta(p.contactId);
    const { itemId } = await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    expect((await itemOf(itemId)).discountReason).toBe("Prêmio do Fiel da Fiaes");
    expect(await saldo(p.contactId)).toBe(0);
  });

  it("recusas: sem a permissão, serviço que não é prêmio, comanda sem cliente, trocar a cliente com prêmio na comanda", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId);
    const semPerm = { ...s.caixaRecepcao, perms: s.caixaRecepcao.perms.filter((x) => x !== "fidelidade.resgatar") };
    await expect(redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, semPerm, NOW)).rejects.toThrow("Você não tem permissão para isso.");
    await expect(redeemLoyalty(c, fiel, { serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Corte não é prêmio do Fiel da Fiaes.");
    await expect(redeemLoyalty(await aberta(null), fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a cliente para usar o prêmio da fidelidade.");
    await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    const q = await cliente("Rita Lima");
    await expect(setComandaClient(c, { contactId: q.contactId }, s.caixaRecepcao, NOW)).rejects.toThrow("Tire o prêmio da fidelidade antes de trocar a cliente.");
  });

  it("o resgate não passa pelo addItem da tela (ruleDiscount é só do domínio)", async () => {
    await aprovacao(1000);
    const p = await cliente("Paula Souza");
    const c = await aberta(p.contactId);
    await expect(addItem(c, { ...corte({ discountPercent: 100, reason: "Fidelidade: Fiel da Fiaes" }), ruleDiscount: "fidelidade" }, s.caixaRecepcao, NOW)).rejects.toThrow(ApprovalNeededError);
  });
});

describe("Aniversário", () => {
  it("Aniversário: só no mês do aniversário, uma vez por ano, 50% no item escolhido", async () => {
    const p = await cliente("Paula Souza");
    await db.update(contacts).set({ birthDay: 20, birthMonth: 10 }).where(eq(contacts.id, p.contactId));
    expect(await status(p.contactId, aniv)).toMatchObject({ kind: "aniversario", goal: null, ready: true, rewardServiceIds: [ritual.id] });
    const ritualItem: AddItemInput = { kind: "servico", serviceId: ritual.id, professionalId: s.ana.id };
    const c = await aberta(p.contactId, [corte(), ritualItem]);
    const its = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c)).orderBy(comandaItems.createdAt);
    await expect(redeemLoyalty(c, aniv, { itemId: its[0].id }, s.caixaRecepcao, NOW)).rejects.toThrow("Corte não é prêmio do Aniversário.");
    await redeemLoyalty(c, aniv, { itemId: its[1].id }, s.caixaRecepcao, NOW);
    expect(await itemOf(its[1].id)).toMatchObject({ discountCents: 10000, discountReason: "Fidelidade: Aniversário" });
    expect((await db.select().from(loyaltyEntries).where(eq(loyaltyEntries.programId, aniv)))[0]).toMatchObject({ delta: -1, reason: "resgate", comandaItemId: its[1].id });
    expect((await status(p.contactId, aniv)).ready).toBe(false);
    await fechar(c);
    // Uma vez por ano.
    const outra = await aberta(p.contactId, [ritualItem]);
    const [it2] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, outra));
    await expect(redeemLoyalty(outra, aniv, { itemId: it2.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Paula já usou o prêmio de Aniversário este ano.");
    // No ano seguinte, de novo no mês do aniversário.
    expect((await status(p.contactId, aniv, new Date(Date.UTC(2027, 9, 5, 15)))).ready).toBe(true);
    // Fora do mês do aniversário.
    const q = await cliente("Rita Lima");
    await db.update(contacts).set({ birthDay: 3, birthMonth: 11 }).where(eq(contacts.id, q.contactId));
    expect((await status(q.contactId, aniv)).ready).toBe(false);
    const c3 = await aberta(q.contactId, [ritualItem]);
    const [it3] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c3));
    await expect(redeemLoyalty(c3, aniv, { itemId: it3.id }, s.caixaRecepcao, NOW)).rejects.toThrow("O prêmio de Aniversário é só no mês do aniversário.");
  });

  it("o prêmio do aniversário cancelado volta a valer no mesmo ano; o mês é o de Salvador", async () => {
    const p = await cliente("Paula Souza");
    await db.update(contacts).set({ birthMonth: 10 }).where(eq(contacts.id, p.contactId));
    const c = await aberta(p.contactId, [{ kind: "servico", serviceId: ritual.id, professionalId: s.ana.id }]);
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c));
    await redeemLoyalty(c, aniv, { itemId: it.id }, s.caixaRecepcao, NOW);
    await fechar(c);
    await cancelComanda(c, { reason: "lançada errado" }, s.caixaGestao, NOW);
    expect((await status(p.contactId, aniv)).ready).toBe(true);
    // 01/11 00:30 UTC ainda é 31/10 em Salvador.
    expect((await status(p.contactId, aniv, bahia(31, 21, 30))).ready).toBe(true);
  });
});

describe("updateItem no prêmio", () => {
  it("o item do prêmio continua com o desconto ao mudar a profissional", async () => {
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId);
    const { itemId } = await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    await updateItem(itemId, { professionalId: s.bia.id }, s.caixaRecepcao, NOW);
    expect(await itemOf(itemId)).toMatchObject({ professionalId: s.bia.id, discountCents: 8000 });
  });

  it("quantidade, preço e desconto do item do prêmio não mudam (com a aprovação ligada)", async () => {
    await aprovacao(1000);
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId);
    const { itemId } = await redeemLoyalty(c, fiel, { serviceId: fin.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    const msg = "Esse item é prêmio da fidelidade. Tire o prêmio e use de novo para mudar.";
    await expect(updateItem(itemId, { qty: 3 }, s.caixaRecepcao, NOW)).rejects.toThrow(msg);
    await expect(updateItem(itemId, { unitCents: 30000, reason: "outro valor" }, s.caixaRecepcao, NOW)).rejects.toThrow(msg);
    await expect(updateItem(itemId, { discountPercent: 50, reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow(msg);
    await expect(updateItem(itemId, { discountCents: 100, reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow(msg);
    expect(await itemOf(itemId)).toMatchObject({ qty: 1, unitCents: 8000, discountCents: 8000 });
  });

  it("a aprovação desconta só a parte do prêmio (1 unidade), não o item inteiro", async () => {
    await aprovacao(1000);
    const p = await cliente("Paula Souza");
    await pontos(p.contactId, fiel, 12);
    const c = await aberta(p.contactId, [{ kind: "servico", serviceId: fin.id, professionalId: s.ana.id, qty: 3 }]); // 24.000
    const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c));
    await redeemLoyalty(c, fiel, { itemId: it.id }, s.caixaRecepcao, NOW);
    expect(await itemOf(it.id)).toMatchObject({ discountCents: 8000 }); // uma unidade
    // 3.000 na comanda sobre os 16.000 que sobram: 18,75%, acima de 10%.
    await expect(setComandaDiscount(c, { cents: 3000, reason: "cliente antiga" }, s.caixaRecepcao, NOW)).rejects.toThrow(ApprovalNeededError);
    await setComandaDiscount(c, { cents: 1600, reason: "cliente antiga" }, s.caixaRecepcao, NOW); // 10%: passa
  });
});
