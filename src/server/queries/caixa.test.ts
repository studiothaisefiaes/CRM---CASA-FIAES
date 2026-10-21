import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, comandas, contacts } from "../db/schema";
import { saveFuncoes } from "../domain/funcoes";
import { resetDb } from "../../../test/db";
import { bahia, cliente, NOW, setSetting } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { createVisit } from "../domain/agenda/visits";
import { addItem, addPayment, closeComanda, discardComanda, undoDiscardComanda, openComandaForAppointment, openWalkInComanda, setComandaCpf, setComandaNota } from "../domain/caixa/comandas";
import { closeCash, openCash } from "../domain/caixa/cash";
import { DEFAULT_CAIXA_RULES } from "../../lib/caixa-settings";
import { comandaFechada } from "../../../test/comanda-fixtures";
import { ensureArrivedComandas } from "../domain/caixa/arrivals";
import { loadNotas } from "../reports/financeiro/notas";
import { listDebtors } from "../domain/caixa/debts";
import { getCaixaHoje, isBlindFor, listAgendadasHoje, getCaixaQueue, getComandaDetail, listCashSessions, listDayComandas, listPackagesNeedingAttention, listTeamCash } from "./caixa";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

it("detalhe da comanda: itens com total, pagamentos (bandeira, observação, dona do caixa), quanto falta, CPF e o saldo de crédito", async () => {
  const p = await cliente("Paula Souza");
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
  await addPayment(w.comandaId, { method: "credito", valueCents: 5000, brand: "elo", installments: 2, note: "maquininha 2" }, s.caixaRecepcao, NOW);
  await setComandaCpf(w.comandaId, "529.982.247-25", s.caixaRecepcao, NOW);
  const d = (await getComandaDetail(w.comandaId, s.cati.id))!;
  expect(d).toMatchObject({ number: 1, status: "aberta", clientName: "Paula Souza", paidCents: 5000, remainingCents: 7000, creditBalance: 0, cashOpen: true, exigeCaixaAberto: false, cpf: "52998224725", changePreviewCents: 0 });
  expect(d.items).toEqual([expect.objectContaining({ label: "Corte", totalCents: 12000, professionalName: "Ana", originalUnitCents: 12000, fiscalKind: "servico", priceReason: null })]);
  expect(d.payments).toEqual([expect.objectContaining({ method: "credito", brand: "elo", installments: 2, note: "maquininha 2", sessionOwnerName: "Cati", customLabel: null, changeCents: 0 })]);
  expect((await getComandaDetail(w.comandaId, s.gestora.id))!.cashOpen).toBe(false); // o caixa é de quem vê
});

/** Comanda da visita (h em 15/10) de uma cliente, com os serviços dados. */
async function visita(nome: string, h: number, items: { serviceId: string; professionalId: string }[]) {
  const p = await cliente(nome);
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, h).toISOString(), items: items.map((i, k) => ({ ...i, preference: "escolhida" as const, mode: k ? "depois" as const : undefined })) }, s.recepcao, bahia(15, 7));
  const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
  return { ...c, appointmentIds: v.appointmentIds };
}
const finaliza = (id: string, h: number, m = 0) => db.update(appointments).set({ status: "compareceu", finishedAt: bahia(15, h, m) }).where(eq(appointments.id, id));

it("fila: A receber só com todos os serviços finalizados, da mais antiga para a mais nova; Em atendimento; Pagas hoje", async () => {
  const ontem = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Rosa de ontem" }, s.caixaRecepcao, bahia(14, 15));
  await addItem(ontem.comandaId, { kind: "produto", label: "Kit", unitCents: 5000 }, s.caixaRecepcao, bahia(14, 15));
  const a = await visita("Paula Souza", 10, [{ serviceId: s.corte.id, professionalId: s.ana.id }]);
  await finaliza(a.appointmentIds[0], 11, 10);
  await addPayment(a.comandaId, { method: "pix", valueCents: 2000 }, s.caixaRecepcao, NOW);
  const b = await visita("Rita Lima", 9, [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }]);
  await finaliza(b.appointmentIds[0], 10);
  await db.update(appointments).set({ status: "em_atendimento" }).where(eq(appointments.id, b.appointmentIds[1]));
  const vazia = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  const paga = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Lia" }, s.caixaRecepcao, NOW);
  await addItem(paga.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await addPayment(paga.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
  await closeComanda(paga.comandaId, {}, s.caixaRecepcao, bahia(15, 12));
  const q = await getCaixaQueue(bahia(15, 13));
  expect(q.aReceber.map((r) => [r.clientName, r.totalCents, r.paidCents, r.remainingCents])).toEqual([["Rosa de ontem", 5000, 0, 5000], ["Paula Souza", 12000, 2000, 10000]]);
  expect(q.aReceber[1].services).toEqual([{ label: "Corte", professionalName: "Ana", status: "compareceu" }]);
  expect(q.aReceber[1].since).toBe(bahia(15, 11, 10).toISOString());
  expect(q.emAtendimento.map((r) => r.id).sort()).toEqual([b.comandaId, vazia.comandaId].sort());
  expect(q.pagasHoje.map((r) => [r.clientName, r.totalCents, r.closedByName])).toEqual([["Lia", 4000, "Cati"]]);
});

it("caixa de hoje: o meu caixa (esperado escondido na contagem cega), o total do dia e a fila", async () => {
  await setSetting("caixa_regras", { contagemCega: false });
  await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
  const a = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await addItem(a.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await addPayment(a.comandaId, { method: "dinheiro", valueCents: 5000 }, s.caixaRecepcao, NOW);
  await closeComanda(a.comandaId, {}, s.caixaRecepcao, NOW);
  const h = await getCaixaHoje(s.caixaRecepcao, NOW);
  expect(h).toMatchObject({ day: "2026-10-15", mode: "crm", myName: "Cati", totals: { totalCents: 4000 } });
  expect(h.mine?.expected?.dinheiro).toBe(14000);
  expect(h.queue.pagasHoje).toHaveLength(1);
  expect((await getCaixaHoje(s.caixaGestao, NOW)).mine).toBeNull();
  await setSetting("caixa_regras", { contagemCega: true });
  // Contagem cega: nada de onde se tire o esperado (recebido por forma, fundo, sangrias, bandeiras, total do dia).
  const cega = await getCaixaHoje(s.caixaRecepcao, NOW);
  expect(cega.mine).toEqual({ sessionId: h.mine!.sessionId, openedAt: h.mine!.openedAt, blind: true, openComandas: 0, expected: null, byBrand: [] });
  expect(cega.totals).toBeNull();
  expect((await getCaixaHoje(s.caixaGestao, NOW)).totals).not.toBeNull(); // a gestão vê
  // QA r58, I-1: "Pagas hoje" também não mostra o valor de cada comanda (a soma seria o esperado).
  expect(cega.queue.pagasHoje).toEqual([expect.objectContaining({ id: a.comandaId, totalCents: null, paidCents: null, remainingCents: null })]);
  expect((await getCaixaHoje(s.caixaGestao, NOW)).queue.pagasHoje[0]).toMatchObject({ totalCents: 4000 });
  const l = await listDayComandas("2026-10-15");
  expect([l.abertas.length, l.fechadas.length]).toEqual([0, 1]);
});

it("contagem cega nasce ligada (QA r58, I-1): sem regra gravada, a atendente não vê o total do dia nem o valor das pagas", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const a = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await addItem(a.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await addPayment(a.comandaId, { method: "pix", valueCents: 4000 }, s.caixaRecepcao, NOW);
  await closeComanda(a.comandaId, {}, s.caixaRecepcao, NOW);
  const h = await getCaixaHoje(s.caixaRecepcao, NOW);
  expect(h.rules.contagemCega).toBe(true);
  expect(h.totals).toBeNull();
  expect(h.mine).toMatchObject({ blind: true, expected: null });
  expect(h.queue.pagasHoje.map((r) => [r.clientName, r.totalCents])).toEqual([["Cliente de balcão", null]]);
});

it("fechamentos (QA r58, I-10): quem não tem caixa.gerir vê só os próprios caixas; a gestão vê todos, com a diferença por forma", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  await closeCash({ cashBreakdown: { "1000": 1 }, counted: { pix: 0 }, approverId: s.gestora.id }, s.caixaRecepcao, NOW); // 10 a mais no dinheiro
  await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
  expect((await listCashSessions({ viewer: s.caixaRecepcao })).map((r) => r.openedByName)).toEqual(["Cati"]);
  const todos = await listCashSessions({ viewer: s.caixaGestao });
  expect(todos.map((r) => r.openedByName).sort()).toEqual(["Cati", "Thaíse Fiaes"]);
  expect(todos.find((r) => r.openedByName === "Cati")!.differences).toEqual([{ method: "dinheiro", cents: 1000 }]);
});

it("caixas da equipe: os abertos e os fechados hoje, por pessoa, com o recebido e a diferença", async () => {
  const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
  await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await addPayment(w.comandaId, { method: "dinheiro", valueCents: 4000 }, s.caixaRecepcao, NOW);
  await closeCash({ cashBreakdown: { "5000": 1 }, counted: {}, approverId: s.gestora.id }, s.caixaGestao, NOW); // 50 a mais: a gestão aprova a própria diferença
  const rows = await listTeamCash(NOW);
  expect(rows.map((r) => [r.personName, r.status, r.openingCents, r.received.dinheiro, r.expectedCash, r.differenceCents, r.approvedByName])).toEqual([
    ["Cati", "aberto", 10000, 4000, 14000, null, null],
    ["Thaíse Fiaes", "fechado", 0, 0, 0, 5000, "Thaíse Fiaes"],
  ]);
  expect(rows[0].id).toBe(a.id);
});

it("pacotes que pedem a gestão: vencidos com sessão (novo prazo) e sem valor por sessão (comissão)", async () => {
  const p = await cliente("Paula Souza");
  await db.insert(clientPackages).values([
    { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, validUntil: "2026-10-03", unitCents: 10000, externalKey: "t:1" },
    { contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo Avec", serviceLabel: "Corte", totalSessions: 4, usedSessions: 4, validUntil: "2027-01-01", externalKey: "t:2" },
    { contactId: p.contactId, clientName: "Paula Souza", packageName: "Escova", serviceLabel: "Escova", totalSessions: 2, usedSessions: 0, validUntil: null, externalKey: "t:3" },
  ]);
  const r = await listPackagesNeedingAttention("2026-10-15");
  expect(r.vencidos.map((x) => x.packageName)).toEqual(["Combo"]);
  expect(r.semValor.map((x) => x.packageName)).toEqual(["Escova"]); // esgotado não entra
});

it("item 20: o detalhe da comanda traz o aviso fixo e o uso de imagem da cliente; função uso_imagem desligada esconde o uso de imagem", async () => {
  const p = await cliente("Paula Souza");
  await db.update(contacts).set({ alertNotes: "Alérgica a amônia", imageUse: "nao" }).where(eq(contacts.id, p.contactId));
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
  expect(await getComandaDetail(w.comandaId, s.cati.id)).toMatchObject({ alertNotes: "Alérgica a amônia", imageUse: "nao" });
  await saveFuncoes({ uso_imagem: false }, s.gestora.id);
  expect(await getComandaDetail(w.comandaId, s.cati.id)).toMatchObject({ alertNotes: "Alérgica a amônia", imageUse: null });
});

it("caixa no escuro por perfil: sem caixa.dinheiro é cega mesmo com a contagem cega desligada; caixa.gerir nunca", () => {
  const regras = { ...DEFAULT_CAIXA_RULES, contagemCega: false };
  expect(isBlindFor(regras, { perms: ["caixa.operar", "caixa.dinheiro"] })).toBe(false);
  expect(isBlindFor(regras, { perms: ["caixa.operar"] })).toBe(true);
  expect(isBlindFor({ ...regras, contagemCega: true }, { perms: ["caixa.operar", "caixa.dinheiro"] })).toBe(true);
  expect(isBlindFor({ ...regras, contagemCega: true }, { perms: ["caixa.gerir"] })).toBe(false);
});

it("Fechamentos: com caixa.outros vê os de todas; sem, só os próprios (caixa.gerir sozinho não mostra os das outras)", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
  expect((await listCashSessions({ viewer: { id: s.cati.id, perms: ["caixa.operar", "caixa.gerir"] } })).map((r) => r.openedByName)).toEqual(["Cati"]);
  expect((await listCashSessions({ viewer: { id: s.cati.id, perms: ["caixa.operar", "caixa.outros"] } })).map((r) => r.openedByName).sort()).toEqual(["Cati", "Thaíse Fiaes"]);
});

/** Horário do dia 15/10 de uma cliente (sem comanda). */
async function agendar(nome: string, h: number, m = 0) {
  const p = await cliente(nome);
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, h, m).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" as const }] }, s.recepcao, bahia(14, 7));
  return { ...p, appointmentId: v.appointmentIds[0] };
}

it("Agendadas de hoje: só quem tem horário e ainda não tem comanda aberta ou paga; sem cancelado, 00:00 nem CLIENTE PADRÃO", async () => {
  const livre = await agendar("Ana Livre", 9);
  const aberta = await agendar("Bia Aberta", 10);
  const paga = await agendar("Cris Paga", 11);
  const cancelada = await agendar("Dani Cancelada", 12);
  const meia = await agendar("Eva Meianoite", 14);
  await db.update(appointments).set({ startsAt: bahia(15, 0) }).where(eq(appointments.id, meia.appointmentId)); // o Avec grava "sem hora" como 00:00
  const padrao = await agendar("Fulana Padrao", 13);
  await db.update(appointments).set({ clientName: "CLIENTE PADRÃO", contactId: null }).where(eq(appointments.id, padrao.appointmentId));
  await openComandaForAppointment(aberta.appointmentId, s.caixaRecepcao, NOW);
  const c = await openComandaForAppointment(paga.appointmentId, s.caixaRecepcao, NOW);
  await addPayment(c.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, NOW);
  await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW);
  await db.update(appointments).set({ status: "cancelado" }).where(eq(appointments.id, cancelada.appointmentId));
  expect((await listAgendadasHoje("2026-10-15")).map((r) => [r.clientName, r.appointmentId])).toEqual([["Ana Livre", livre.appointmentId]]);
  // Abrir a comanda da agendada a tira da lista (e a traz para a fila).
  await openComandaForAppointment(livre.appointmentId, s.caixaRecepcao, NOW);
  expect(await listAgendadasHoje("2026-10-15")).toEqual([]);
  expect((await getCaixaHoje(s.caixaRecepcao, NOW)).agendadas).toEqual([]);
});

it("Devendo: dívida aberta por cliente (a mais antiga primeiro), só para quem tem caixa.divida; quitada sai", async () => {
  const p = await cliente("Paula Souza");
  const r = await cliente("Rita Lima");
  const d1 = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
  await comandaFechada(s, { contactId: r.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 9000 }], leaveDebt: true });
  const lista = await listDebtors();
  expect(lista.map((d) => [d.name, d.totalCents, d.debts, d.comandaId === d1.comandaId])).toEqual([["Paula Souza", 10000, 1, true], ["Rita Lima", 3000, 1, false]]);
  expect(lista[0].sinceDay).toBe("2026-10-15");
  expect((await getCaixaHoje(s.caixaRecepcao, NOW)).devendo?.map((d) => d.name)).toEqual(["Paula Souza", "Rita Lima"]);
  expect((await getCaixaHoje({ id: s.cati.id, perms: ["caixa.operar"] }, NOW)).devendo).toBeNull();
  const q = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
  await addItem(q.comandaId, { kind: "divida", settlesComandaId: d1.comandaId }, s.caixaRecepcao, NOW);
  await addPayment(q.comandaId, { method: "pix", valueCents: 10000 }, s.caixaRecepcao, NOW);
  await closeComanda(q.comandaId, {}, s.caixaRecepcao, NOW);
  expect((await listDebtors()).map((d) => d.name)).toEqual(["Rita Lima"]);
});

it("quem já chegou ganha a comanda dos serviços da visita (Em atendimento ou A receber), sem repetir e sem voltar depois de cancelada", async () => {
  const a = await agendar("Ana Chegou", 9);
  const b = await agendar("Bia Finalizada", 10);
  await agendar("Cris Ainda Vai", 11);
  await db.update(appointments).set({ status: "chegou" }).where(eq(appointments.id, a.appointmentId));
  await db.update(appointments).set({ status: "compareceu", finishedAt: bahia(15, 11) }).where(eq(appointments.id, b.appointmentId));
  expect(await ensureArrivedComandas("2026-10-15", s.caixaRecepcao, NOW)).toBe(2);
  expect(await ensureArrivedComandas("2026-10-15", s.caixaRecepcao, NOW)).toBe(0);
  const q = await getCaixaQueue(NOW);
  expect(q.emAtendimento.map((r) => [r.clientName, r.services[0]?.label])).toEqual([["Ana Chegou", "Corte"]]);
  expect(q.aReceber.map((r) => r.clientName)).toEqual(["Bia Finalizada"]);
  expect((await listAgendadasHoje("2026-10-15")).map((r) => r.clientName)).toEqual(["Cris Ainda Vai"]);
  // Cancelar a comanda (com motivo) não faz ela voltar na próxima abertura do Caixa.
  await discardComanda(q.emAtendimento[0].id, s.caixaRecepcao, NOW, { reason: "foi embora" });
  expect(await ensureArrivedComandas("2026-10-15", s.caixaRecepcao, NOW)).toBe(0);
  const [c] = await db.select().from(comandas).where(eq(comandas.id, q.emAtendimento[0].id));
  expect([c.status, c.cancelReason]).toEqual(["cancelada", "foi embora"]);
});

it("cancelar: comanda com pagamento pede o estorno antes; caixa.cancelar vai para os perfis que operam o caixa", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Lia" }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await addPayment(w.comandaId, { method: "pix", valueCents: 1000 }, s.caixaRecepcao, NOW);
  await expect(discardComanda(w.comandaId, s.caixaRecepcao, NOW, { reason: "desistiu" })).rejects.toThrow(/estorne/i);
  expect(s.caixaRecepcao.perms).toContain("caixa.cancelar");
  expect(s.caixaGestao.perms).toContain("caixa.cancelar");
  expect((await getCaixaHoje(s.caixaRecepcao, NOW)).canCancelar).toBe(true);
  expect((await getCaixaHoje({ id: s.cati.id, perms: ["caixa.operar"] }, NOW)).canCancelar).toBe(false);
});

it("psico r68 #1: cancelar comanda aberta tem desfazer por 10 min (volta 'aberta' com os itens); depois disso, ou se já foi fechada, não", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Lia" }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Shampoo", unitCents: 4000 }, s.caixaRecepcao, NOW);
  await discardComanda(w.comandaId, s.caixaRecepcao, NOW, { reason: "cliquei errado" });
  await undoDiscardComanda(w.comandaId, s.caixaRecepcao, new Date(NOW.getTime() + 5 * 60_000));
  const [c] = await db.select().from(comandas).where(eq(comandas.id, w.comandaId));
  expect([c.status, c.cancelledAt, c.cancelReason]).toEqual(["aberta", null, null]);
  expect((await getComandaDetail(w.comandaId, s.cati.id))!.items.map((i) => i.label)).toEqual(["Shampoo"]);
  // Passou do prazo: não desfaz mais
  await discardComanda(w.comandaId, s.caixaRecepcao, NOW, { reason: "agora sim" });
  await expect(undoDiscardComanda(w.comandaId, s.caixaRecepcao, new Date(NOW.getTime() + 11 * 60_000))).rejects.toThrow(/10 minutos/);
  // Comanda que não está cancelada: nada a desfazer
  const x = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Mia" }, s.caixaRecepcao, NOW);
  await expect(undoDiscardComanda(x.comandaId, s.caixaRecepcao, NOW)).rejects.toThrow(/não está cancelada/);
});

it("nota fiscal no recebimento: escolha gravada, CPF só com 'com CPF', consentimento respeitado, padrão da Casa ao fechar e 'a emitir' no Financeiro", async () => {
  await setSetting("caixa_regras", { notaPadrao: "sem_cpf" }); // este teste confere o padrão "Emitir sem CPF"; o novo padrão (Perguntar) tem teste próprio
  const p = await cliente("Paula Souza");
  const recusou = await cliente("Rita Recusou");
  await db.update(contacts).set({ consentCpfNota: false }).where(eq(contacts.id, recusou.contactId));
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const mk = async (contactId: string) => {
    const w = await openWalkInComanda({ requestKey: randomUUID(), contactId }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 5000 }, s.caixaRecepcao, NOW);
    return w.comandaId;
  };
  const c1 = await mk(p.contactId);
  await expect(setComandaNota(c1, { escolha: "com_cpf" }, s.caixaRecepcao, NOW)).rejects.toThrow(/Digite o CPF/);
  await expect(setComandaNota(c1, { escolha: "com_cpf", cpf: "111.111.111-11" }, s.caixaRecepcao, NOW)).rejects.toThrow(/CPF inválido/);
  await setComandaNota(c1, { escolha: "com_cpf", cpf: "529.982.247-25" }, s.caixaRecepcao, NOW);
  expect((await getComandaDetail(c1, s.cati.id))).toMatchObject({ cpf: "52998224725", notaEscolha: { escolha: "com_cpf", padrao: "sem_cpf" } });
  await setComandaNota(c1, { escolha: "sem_cpf" }, s.caixaRecepcao, NOW);
  expect((await getComandaDetail(c1, s.cati.id))).toMatchObject({ cpf: null, notaEscolha: { escolha: "sem_cpf" } });
  await setComandaNota(c1, { escolha: "com_cpf", cpf: "52998224725" }, s.caixaRecepcao, NOW);
  await addPayment(c1, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
  await closeComanda(c1, {}, s.caixaRecepcao, NOW);

  const c2 = await mk(recusou.contactId);
  await expect(setComandaNota(c2, { escolha: "com_cpf", cpf: "52998224725" }, s.caixaRecepcao, NOW)).rejects.toThrow(/não autorizou/);
  await setComandaNota(c2, { escolha: "nao" }, s.caixaRecepcao, NOW);
  await addPayment(c2, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
  await closeComanda(c2, {}, s.caixaRecepcao, NOW);

  const c3 = await mk(p.contactId); // sem escolha: vale o padrão da Casa (Emitir sem CPF)
  await addPayment(c3, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
  await closeComanda(c3, {}, s.caixaRecepcao, NOW);
  const rows = await db.select({ id: comandas.id, e: comandas.notaEscolha }).from(comandas);
  expect(Object.fromEntries(rows.map((r) => [r.id, r.e]))).toEqual({ [c1]: "com_cpf", [c2]: "nao", [c3]: "sem_cpf" });
  const { aEmitir } = await loadNotas({ from: "2026-10-01", to: "2026-10-31" } as never);
  expect(aEmitir.map((r) => [r.id, r.escolha]).sort()).toEqual([[c1, "com_cpf"], [c3, "sem_cpf"]].sort());
});

it("r66: padrão 'Perguntar' (o novo): a comanda nasce sem escolha de nota (null), e com a emissão ligada fechar sem escolher é recusado", async () => {
  const p = await cliente("Paula Souza");
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 5000 }, s.caixaRecepcao, NOW);
  expect(await getComandaDetail(w.comandaId, s.cati.id)).toMatchObject({ notaEscolha: { escolha: null, padrao: "perguntar" } });
  await setComandaNota(w.comandaId, { escolha: "nao" }, s.caixaRecepcao, NOW);
  expect(await getComandaDetail(w.comandaId, s.cati.id)).toMatchObject({ notaEscolha: { escolha: "nao" } });
});

it("psico r68 #3: com o padrão gravado (Não emitir), a comanda nova já vem com a escolha; só 'Perguntar' deixa em aberto", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  await setSetting("caixa_regras", { notaPadrao: "nao" });
  const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Lia" }, s.caixaRecepcao, NOW);
  expect((await getComandaDetail(w.comandaId, s.cati.id))!.notaEscolha).toMatchObject({ escolha: "nao", padrao: "nao" });
  await setSetting("caixa_regras", { notaPadrao: "perguntar" });
  expect((await getComandaDetail(w.comandaId, s.cati.id))!.notaEscolha).toMatchObject({ escolha: null, padrao: "perguntar" });
});
