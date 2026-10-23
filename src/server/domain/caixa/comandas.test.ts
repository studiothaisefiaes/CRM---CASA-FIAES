import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { clientPackages, comandaItems, comandas, contacts, packageDefs } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { money } from "@/lib/format";
import { cancelAppointments, createVisit } from "../agenda/visits";
import { setAppointmentStatus, undoAppointmentStatus } from "../appointments";
import { addCreditTx } from "./credits";
import { addItem, addPayment, joinTodayAppointments, openComandaForAppointment, openWalkInComanda, removePayment, setComandaClient, setComandaDiscount } from "./comandas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

/** Marca uma visita (pela porta do 6B) hoje, 15/10, na hora dada, com os serviços e profissionais. */
async function marcar(contactId: string, h: number, items: { serviceId: string; professionalId: string }[]) {
  return createVisit({ requestKey: randomUUID(), client: { contactId }, startsAt: bahia(15, h).toISOString(), items: items.map((i, k) => ({ ...i, preference: "escolhida" as const, mode: k ? "depois" as const : undefined })) }, s.recepcao, bahia(15, 8));
}
const itensDe = (comandaId: string) => db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt))).orderBy(comandaItems.createdAt);

describe("abrir", () => {
  it("pela visita: os serviços entram com preço e profissional; abrir de novo reaproveita a mesma, sem repetir item", async () => {
    const p = await cliente("Paula Souza");
    const v = await marcar(p.contactId, 10, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    const r = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    expect(r).toMatchObject({ number: 1, created: true });
    expect((await itensDe(r.comandaId)).map((i) => [i.kind, i.label, i.unitCents, i.professionalId])).toEqual([
      ["servico", "Corte", 12000, s.ana.id], ["servico", "Hidratação", 9000, s.bia.id],
    ]);
    expect(await openComandaForAppointment(v.appointmentIds[1], s.caixaRecepcao, NOW)).toEqual({ comandaId: r.comandaId, number: 1, created: false });
    expect(await itensDe(r.comandaId)).toHaveLength(2);
  });

  it("'Juntar horário de hoje' traz o horário marcado depois (outra visita); sem nada novo, avisa", async () => {
    const p = await cliente("Paula Souza");
    const v1 = await marcar(p.contactId, 10, [{ serviceId: s.corte.id, professionalId: s.ana.id }]);
    const { comandaId } = await openComandaForAppointment(v1.appointmentIds[0], s.caixaRecepcao, NOW);
    await marcar(p.contactId, 14, [{ serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    expect(await joinTodayAppointments(comandaId, s.caixaRecepcao, NOW)).toEqual({ added: 1 });
    await expect(joinTodayAppointments(comandaId, s.caixaRecepcao, NOW)).rejects.toThrow("Nenhum outro horário de hoje para juntar.");
  });

  it("avulsa: 'Cliente de balcão', número seguinte do dia; a mesma request key não abre duas", async () => {
    const key = randomUUID();
    const a = await openWalkInComanda({ requestKey: key }, s.caixaRecepcao, NOW);
    expect(await openWalkInComanda({ requestKey: key }, s.caixaRecepcao, NOW)).toEqual(a);
    const b = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Moça do café" }, s.caixaRecepcao, NOW);
    expect([a.number, b.number]).toEqual([1, 2]);
    expect((await db.select().from(comandas).where(eq(comandas.id, a.comandaId)))[0]).toMatchObject({ clientName: "Cliente de balcão", contactId: null, day: "2026-10-15" });
  });

  it("Nova comanda (QA r58, I-8) nasce com o primeiro item, na mesma transação; item recusado não deixa comanda vazia", async () => {
    const a = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Moça do café", item: { kind: "produto", label: "Kit", unitCents: 5000 } }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.comandaId, a.comandaId))).map((i) => [i.label, i.unitCents])).toEqual([["Kit", 5000]]);
    await expect(openWalkInComanda({ requestKey: randomUUID(), item: { kind: "produto", label: " ", unitCents: 100 } }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o nome do produto.");
    expect(await db.select().from(comandas)).toHaveLength(1);
  });

  it("produto sem catálogo, com o estoque ligado (padrão), pede para escolher o produto", async () => {
    await resetDb(); s = await setupCaixa();
    await expect(openWalkInComanda({ requestKey: randomUUID(), item: { kind: "produto", label: "Kit", unitCents: 100 } }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha o produto (cadastre em Serviços e pacotes › Produtos).");
    expect(await db.select().from(comandas)).toHaveLength(0);
  });

  it("modo avec: recusa", async () => {
    await setSetting("caixa_modo", "avec");
    await expect(openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW)).rejects.toThrow("O caixa ainda é no Avec.");
  });
});

describe("itens, desconto e pagamentos", () => {
  it("serviço pede profissional; produto não; desconto maior que o item ou que a comanda é recusado", async () => {
    const { comandaId } = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await expect(addItem(comandaId, { kind: "servico", serviceId: s.corte.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a profissional de Corte.");
    await addItem(comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, discountPercent: 10, reason: "primeira vez" }, s.caixaRecepcao, NOW);
    await addItem(comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000, qty: 2 }, s.caixaRecepcao, NOW);
    await expect(addItem(comandaId, { kind: "produto", label: "Brinde", unitCents: 1000, discountCents: 1500, reason: "brinde" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto maior que o valor do item.");
    expect((await itensDe(comandaId)).map((i) => [i.label, i.discountCents])).toEqual([["Corte", 1200], ["Shampoo", 0]]);
    await expect(setComandaDiscount(comandaId, { cents: 20000, reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto maior que o total.");
    await setComandaDiscount(comandaId, { percent: 5, reason: "à vista" }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0].discountCents).toBe(940); // 5% de 18.800
  });

  it("pacote: vender exige a cliente; sessão de pacote vencido ou sem saldo é recusada", async () => {
    const p = await cliente("Paula Souza");
    const [def] = await db.insert(packageDefs).values({ name: "Combo Método Fiaes", priceCents: 40000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10000 }] }).returning();
    const balcao = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await expect(addItem(balcao.comandaId, { kind: "pacote_venda", packageDefId: def.id }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a cliente para vender o pacote.");
    const comPaula = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    const [vencido, esgotado] = await db.insert(clientPackages).values([
      { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, validUntil: "2026-10-03", externalKey: "t:1" },
      { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 4, validUntil: "2027-01-01", externalKey: "t:2" },
    ]).returning();
    await expect(addItem(comPaula.comandaId, { kind: "pacote_sessao", clientPackageId: vencido.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("O pacote venceu em 03/10. Só a gestão dá novo prazo.");
    await expect(addItem(comPaula.comandaId, { kind: "pacote_sessao", clientPackageId: esgotado.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW)).rejects.toThrow("O pacote de Paula não tem mais sessões.");
    await addItem(comPaula.comandaId, { kind: "pacote_venda", packageDefId: def.id }, s.caixaRecepcao, NOW);
    expect(await db.select().from(clientPackages).where(eq(clientPackages.origin, "crm"))).toHaveLength(0); // só nasce ao fechar
  });

  it("pagamento: parcelas de 1 a 12; crédito da cliente não passa do saldo; tirar um pagamento", async () => {
    const p = await cliente("Paula Souza");
    const { comandaId } = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
    await addItem(comandaId, { kind: "produto", label: "Kit", unitCents: 10000 }, s.caixaRecepcao, NOW); // sem item não há o que pagar
    await expect(addPayment(comandaId, { method: "credito", valueCents: 5000, installments: 13, brand: "visa" }, s.caixaRecepcao, NOW)).rejects.toThrow("Parcelas de 1 a 12.");
    await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 2000, reason: "troco" }, s.cati.id));
    await expect(addPayment(comandaId, { method: "credito_cliente", valueCents: 3000 }, s.caixaRecepcao, NOW)).rejects.toThrow(`Saldo insuficiente: Paula tem ${money(2000)} de crédito.`);
    const { id } = await addPayment(comandaId, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await removePayment(id, {}, s.caixaRecepcao, NOW);
  });
});

describe("as travas na Agenda", () => {
  it("cancelar horário com comanda aberta tira o item; visita paga não se cancela nem se desfaz pela Agenda", async () => {
    const p = await cliente("Paula Souza");
    const v = await marcar(p.contactId, 10, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
    const { comandaId } = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    await cancelAppointments({ appointmentId: v.appointmentIds[1], reason: "cliente_desmarcou" }, s.recepcao, NOW);
    expect((await itensDe(comandaId)).map((i) => i.label)).toEqual(["Corte"]);
    await db.update(comandas).set({ status: "fechada", closedBy: s.cati.id, closedAt: NOW }).where(eq(comandas.id, comandaId)); // atalho: a 6C.5 fecha de verdade
    await expect(cancelAppointments({ appointmentId: v.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, NOW)).rejects.toThrow("Essa visita já foi paga. Cancele a comanda antes (gestão).");
    await setAppointmentStatus(v.appointmentIds[0], "compareceu", s.cati.id, { via: "comanda", now: NOW });
    await expect(undoAppointmentStatus(v.appointmentIds[0], s.recepcao, NOW)).rejects.toThrow("Essa visita já foi paga: para mudar, a gestão cancela a comanda.");
  });
});

describe("Nova comanda com a cliente de verdade (22/10)", () => {
  const corte = () => ({ kind: "servico" as const, serviceId: s.corte.id, professionalId: s.ana.id });
  it("cliente nova (nome + celular) cria a ficha e liga a comanda; o mesmo celular de novo reaproveita a ficha", async () => {
    const a = await openWalkInComanda({ client: { name: "Marina Barros", phone: "71 99167-0000" }, requestKey: randomUUID(), item: corte() }, s.caixaRecepcao, NOW);
    const [c1] = await db.select().from(comandas).where(eq(comandas.id, a.comandaId));
    expect(c1.clientName).toBe("Marina Barros");
    const fichas = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571991670000"));
    expect(fichas.map((f) => f.id)).toEqual([c1.contactId]);
    const b = await openWalkInComanda({ client: { name: "Lara M.", phone: "(71) 99167-0000" }, requestKey: randomUUID(), item: corte() }, s.caixaRecepcao, NOW);
    const [c2] = await db.select().from(comandas).where(eq(comandas.id, b.comandaId));
    expect([c2.contactId, c2.clientName]).toEqual([c1.contactId, "Marina Barros"]); // nunca duplica nem troca o nome
    expect(await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571991670000"))).toHaveLength(1);
  });
  it("com client: { contactId } usa o nome da ficha; trocar a cliente aceita cliente nova", async () => {
    const p = await cliente("Paula Souza");
    const a = await openWalkInComanda({ client: { contactId: p.contactId }, requestKey: randomUUID(), item: corte() }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandas).where(eq(comandas.id, a.comandaId)))[0].clientName).toBe("Paula Souza");
    await setComandaClient(a.comandaId, { client: { name: "Vera Klein", phone: "71 98888-1111" } }, s.caixaRecepcao, NOW);
    const [c] = await db.select().from(comandas).where(eq(comandas.id, a.comandaId));
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, c.contactId!));
    expect([c.clientName, ct.name, ct.phoneE164]).toEqual(["Vera Klein", "Vera Klein", "+5571988881111"]);
  });
  it("revisão final: não troca a cliente com crédito da cliente lançado, nem a comanda que veio de um horário", async () => {
    const p = await cliente("Paula Souza");
    await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 5000, reason: "ajuste" }, s.cati.id));
    const a = await openWalkInComanda({ client: { contactId: p.contactId }, requestKey: randomUUID(), item: corte() }, s.caixaRecepcao, NOW);
    await addPayment(a.comandaId, { method: "credito_cliente", valueCents: 5000 }, s.caixaRecepcao, NOW);
    await expect(setComandaClient(a.comandaId, { client: { name: "Vera Klein", phone: "71 98888-1111" } }, s.caixaRecepcao, NOW)).rejects.toThrow("Estorne o crédito da cliente antes de trocar a cliente.");
    const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, bahia(15, 8));
    const r = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    await expect(setComandaClient(r.comandaId, { client: { name: "Vera Klein", phone: "71 98888-1111" } }, s.caixaRecepcao, NOW)).rejects.toThrow("Essa comanda é do horário da cliente: troque a cliente na Agenda.");
  });
});
