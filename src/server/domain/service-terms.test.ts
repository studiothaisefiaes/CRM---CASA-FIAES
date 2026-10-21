import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, auditLog, comandaItems, lists, professionalServices, settings } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, NOW } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { serviceTermsFor } from "./service-terms";
import { setProfessionalServiceTerms } from "./professionals";
import { createService, listServicesPage, updateService } from "./services";
import { saveFuncoes } from "./funcoes";
import { createVisit, rescheduleAppointment, type CreateVisitInput } from "./agenda/visits";
import { previewBooking } from "./agenda/slots";
import { nextFreeSlots } from "./agenda/availability";
import { addItem, openComandaForAppointment, openWalkInComanda, PRICE_REASON } from "./caixa/comandas";
import { loadCasaData } from "../ai/suggest";
import { buildSystem } from "../ai/prompt";
import { onlineOptions } from "./client-link/online";
import { getDealDetail, getDealSheetData } from "../queries/deal";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
afterEach(() => { vi.useRealTimers(); });

const at = (h: number, m = 0) => bahia(16, h, m).toISOString();
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: at(10), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], ...over,
});
const apptsOf = (visitId: string) => db.select().from(appointments).where(eq(appointments.visitId, visitId)).orderBy(asc(appointments.startsAt), asc(appointments.professionalId));
/** Ana faz Corte em 150 min por R$ 300 (o serviço: 60 min, R$ 120). */
const anaPropria = () => setProfessionalServiceTerms(s.ana.id, s.corte.id, { priceCents: 30000, durationMin: 150 }, s.gestora.id);

describe("preço e tempo por profissional", () => {
  it("Ana com preço e tempo próprios: marcar com Ana usa 150 min e R$ 300 no horário; com Bia, o do serviço", async () => {
    await anaPropria();
    expect(await serviceTermsFor(db, s.corte.id, s.ana.id)).toEqual({ priceCents: 30000, durationMin: 150, bufferMin: null, priceKind: null });
    expect(await serviceTermsFor(db, s.corte.id, s.bia.id)).toEqual({ priceCents: 12000, durationMin: 60, bufferMin: null, priceKind: null });
    expect(await serviceTermsFor(db, s.corte.id, null)).toEqual({ priceCents: 12000, durationMin: 60, bufferMin: null, priceKind: null });
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    const r1 = await createVisit(book(p.contactId), s.recepcao, NOW);
    expect((await apptsOf(r1.visitId))[0]).toMatchObject({ professionalId: s.ana.id, durationMin: 150, priceCents: 30000 });
    const r2 = await createVisit(book(q.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.bia.id }] }), s.recepcao, NOW);
    expect((await apptsOf(r2.visitId))[0]).toMatchObject({ professionalId: s.bia.id, durationMin: 60, priceCents: 12000 });
  });

  it("o 'logo depois' começa no fim do tempo dela, e a prévia da Agenda confere com o tempo dela", async () => {
    await anaPropria();
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "depois" }] }), s.recepcao, NOW);
    expect((await apptsOf(r.visitId)).map((a) => a.startsAt.toISOString())).toEqual([at(10), at(12, 30)]);
    // Ana tem outra cliente às 11:00: com 60 min ela estaria livre às 9:30; com os 150 dela, não.
    await ap({ startsAt: bahia(17, 11), professionalId: s.ana.id, clientName: "Maria Avec" });
    const prev = await previewBooking({ serviceId: s.corte.id, professionalId: s.ana.id, day: "2026-10-17", time: "09:30" }, NOW);
    expect(prev.preview).toMatchObject({ state: "encaixe" });
  });

  it("'Qualquer uma' confere cada candidata com o tempo dela", async () => {
    await anaPropria();
    // Ana tem 1 horário às 11:00; Bia tem 2 (14:00 e 16:00). Às 10:00, com 60 min a Ana (menos horários) seria a escolhida.
    await ap({ startsAt: bahia(16, 11), professionalId: s.ana.id, clientName: "Maria Avec" });
    await ap({ startsAt: bahia(16, 14), professionalId: s.bia.id, clientName: "Rita Avec" });
    await ap({ startsAt: bahia(16, 16), professionalId: s.bia.id, clientName: "Lia Avec" });
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: null }] }), s.recepcao, NOW);
    expect((await apptsOf(r.visitId))[0]).toMatchObject({ professionalId: s.bia.id, durationMin: 60, priceCents: 12000, anyPro: true });
    // Às 9:00 do dia 17 as duas estão livres e sem horários: a Ana (ordem da agenda), com o tempo e o preço dela.
    const q = await cliente("Joana Lima");
    const r2 = await createVisit(book(q.contactId, { startsAt: bahia(17, 9).toISOString(), items: [{ serviceId: s.corte.id, professionalId: null }] }), s.recepcao, NOW);
    expect((await apptsOf(r2.visitId))[0]).toMatchObject({ professionalId: s.ana.id, durationMin: 150, priceCents: 30000 });
  });

  it("'Qualquer uma' seguida de 'logo depois': o segundo serviço começa no fim do tempo de quem foi escolhida", async () => {
    await anaPropria();
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { startsAt: bahia(17, 9).toISOString(), items: [{ serviceId: s.corte.id, professionalId: null }, { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "depois" }] }), s.recepcao, NOW);
    const list = await apptsOf(r.visitId);
    expect(list.map((a) => [a.professionalId, a.startsAt.toISOString(), a.durationMin])).toEqual([[s.ana.id, bahia(17, 9).toISOString(), 150], [s.bia.id, bahia(17, 11, 30).toISOString(), 45]]);
  });

  it("função 'Preço e tempo por profissional' desligada: volta ao do serviço (marcar, 'Qualquer uma' e comanda) e gravar é recusado", async () => {
    await anaPropria();
    await saveFuncoes({ preco_por_profissional: false }, s.gestora.id);
    expect(await serviceTermsFor(db, s.corte.id, s.ana.id)).toEqual({ priceCents: 12000, durationMin: 60, bufferMin: null, priceKind: null });
    await expect(setProfessionalServiceTerms(s.ana.id, s.corte.id, { priceCents: 1000 }, s.gestora.id)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await ap({ startsAt: bahia(16, 11), professionalId: s.ana.id, clientName: "Maria Avec" });
    await ap({ startsAt: bahia(16, 14), professionalId: s.bia.id, clientName: "Rita Avec" });
    await ap({ startsAt: bahia(16, 16), professionalId: s.bia.id, clientName: "Lia Avec" });
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: null }] }), s.recepcao, NOW);
    expect((await apptsOf(r.visitId))[0]).toMatchObject({ professionalId: s.ana.id, durationMin: 60, priceCents: 12000 });
    const c = await openWalkInComanda({ requestKey: randomUUID(), item: { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id } }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId)))[0]).toMatchObject({ unitCents: 12000, originalUnitCents: 12000 });
  });

  it("gravar: só para quem faz o serviço, valores conferidos, vazio volta ao do serviço, e fica na auditoria", async () => {
    const [escova] = await db.insert(lists).values({ kind: "service", label: "Escova", durationMin: 40, priceCents: 5000 }).returning();
    await expect(setProfessionalServiceTerms(s.ana.id, escova.id, { priceCents: 1000 }, s.gestora.id)).rejects.toThrow("Ana não faz esse serviço. Marque em Quem faz antes.");
    await expect(setProfessionalServiceTerms(s.ana.id, s.corte.id, { durationMin: 3 }, s.gestora.id)).rejects.toThrow("Confira o tempo: de 5 a 720 minutos.");
    await expect(setProfessionalServiceTerms(s.ana.id, s.corte.id, { durationMin: 721 }, s.gestora.id)).rejects.toThrow("Confira o tempo: de 5 a 720 minutos.");
    await expect(setProfessionalServiceTerms(s.ana.id, s.corte.id, { priceCents: -1 }, s.gestora.id)).rejects.toThrow("Confira o preço: use um valor como 150,00.");
    await anaPropria();
    await setProfessionalServiceTerms(s.ana.id, s.corte.id, { durationMin: null }, s.gestora.id);
    expect(await serviceTermsFor(db, s.corte.id, s.ana.id)).toMatchObject({ priceCents: 30000, durationMin: 60 });
    const [link] = await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, s.ana.id), eq(professionalServices.serviceId, s.corte.id)));
    expect(link).toMatchObject({ priceCents: 30000, durationMin: null });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, "profissional_servico_valores"), eq(auditLog.entityId, s.ana.id)));
    expect(audits.map((a) => a.data)).toContainEqual({ serviceId: s.corte.id, de: { priceCents: 30000, durationMin: 150 }, para: { priceCents: 30000, durationMin: null } });
  });

  it("remarcar trocando a profissional: preço e tempo da nova (os próprios dela, senão os do serviço); com a função desligada, os do serviço", async () => {
    await anaPropria();
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    const [id] = r.appointmentIds;
    const row = async () => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
    await rescheduleAppointment(id, { startsAt: at(14), professionalId: s.bia.id }, s.recepcao, NOW);
    expect(await row()).toMatchObject({ professionalId: s.bia.id, durationMin: 60, priceCents: 12000 });
    // Bia com os próprios dela; o tempo digitado na remarcação vence o dela.
    await setProfessionalServiceTerms(s.bia.id, s.corte.id, { priceCents: 20000, durationMin: 90 }, s.gestora.id);
    await rescheduleAppointment(id, { startsAt: at(10), professionalId: s.ana.id }, s.recepcao, NOW);
    expect(await row()).toMatchObject({ professionalId: s.ana.id, durationMin: 150, priceCents: 30000 });
    await rescheduleAppointment(id, { startsAt: at(14), professionalId: s.bia.id, durationMin: 45 }, s.recepcao, NOW);
    expect(await row()).toMatchObject({ professionalId: s.bia.id, durationMin: 45, priceCents: 20000 });
    // Mesma profissional, outro horário: nada muda no preço e no tempo.
    await rescheduleAppointment(id, { startsAt: at(15) }, s.recepcao, NOW);
    expect(await row()).toMatchObject({ durationMin: 45, priceCents: 20000 });
    await saveFuncoes({ preco_por_profissional: false }, s.gestora.id);
    await rescheduleAppointment(id, { startsAt: at(10), professionalId: s.ana.id }, s.recepcao, NOW);
    expect(await row()).toMatchObject({ professionalId: s.ana.id, durationMin: 60, priceCents: 12000 });
  });

  it("Procurar horário: cada profissional com o tempo dela (Ana, 150 min, não aparece livre às 9:00 com outra cliente às 11:00)", async () => {
    await anaPropria();
    await ap({ startsAt: bahia(15, 11), professionalId: s.ana.id, clientName: "Maria Avec" });
    const r = await nextFreeSlots({ serviceId: s.corte.id, now: NOW });
    if (!r.ok) throw new Error("esperava ok");
    const ana = r.pros.find((x) => x.id === s.ana.id)!, bia = r.pros.find((x) => x.id === s.bia.id)!;
    expect(bia.slots[0]).toMatchObject({ day: "2026-10-15", start: 540 });
    expect(ana.slots.some((x) => x.day === "2026-10-15" && x.start < 720)).toBe(false);
    expect(ana.slots[0]).toMatchObject({ day: "2026-10-15", start: 720 });
  });

  it("Marcar: serviço sem duração em que a profissional tem tempo próprio não pede a duração", async () => {
    await setProfessionalServiceTerms(s.ana.id, s.mechas.id, { durationMin: 90 }, s.gestora.id);
    const prev = await previewBooking({ serviceId: s.mechas.id, professionalId: s.ana.id, day: "2026-10-16", time: "10:00" }, NOW);
    expect(prev).toMatchObject({ needsDuration: false, durationMin: 90, preview: { state: "livre" } });
    expect((await previewBooking({ serviceId: s.mechas.id, professionalId: s.bia.id, day: "2026-10-16", time: "10:00" }, NOW))).toMatchObject({ needsDuration: true, preview: null });
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.mechas.id, professionalId: s.ana.id }] }), s.recepcao, NOW);
    expect((await apptsOf(r.visitId))[0]).toMatchObject({ durationMin: 90 });
  });

  it("a aba Serviços devolve o preço e o tempo de cada profissional", async () => {
    await anaPropria();
    const corte = (await listServicesPage()).services.find((x) => x.id === s.corte.id)!;
    expect(corte.proTerms).toEqual({ [s.ana.id]: { priceCents: 30000, durationMin: 150 } });
  });
});

describe("comanda", () => {
  it("comanda: item de serviço com a Ana parte do preço dela (mudar dele pede motivo)", async () => {
    await anaPropria();
    const c = await openWalkInComanda({ requestKey: randomUUID(), item: { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id } }, s.caixaRecepcao, NOW);
    const items = () => db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, c.comandaId), isNull(comandaItems.cancelledAt))).orderBy(comandaItems.createdAt);
    expect((await items())[0]).toMatchObject({ unitCents: 30000, originalUnitCents: 30000 });
    // Com a Bia, o do serviço; o preço do serviço com a Ana já é mudança (pede motivo).
    await addItem(c.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.bia.id }, s.caixaRecepcao, NOW);
    expect((await items())[1]).toMatchObject({ unitCents: 12000, originalUnitCents: 12000 });
    await expect(addItem(c.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 12000 }, s.caixaRecepcao, NOW)).rejects.toThrow(PRICE_REASON);
    await addItem(c.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 30000 }, s.caixaRecepcao, NOW);
  });

  it("o horário marcado com a Ana entra na comanda com o preço dela", async () => {
    await anaPropria();
    const p = await cliente("Paula Souza");
    const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }] }, s.recepcao, bahia(15, 8));
    const r = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.comandaId, r.comandaId)))[0]).toMatchObject({ unitCents: 30000, originalUnitCents: 30000 });
  });
});

describe("pode ser feito junto com outro", () => {
  const juntos = async () => {
    await updateService(s.corte.id, { parallelOk: true }, s.gestora.id);
    await updateService(s.hidratacao.id, { parallelOk: true }, s.gestora.id);
  };
  /** Paula: Corte com a Ana às 10:00; depois, Hidratação com a Bia às 10:30 (10 min depois: não é "acabou de ser ocupado"). */
  const hidratacaoComBia = async (contactId: string, fitIn?: boolean) =>
    createVisit(book(contactId, { startsAt: at(10, 30), items: [{ serviceId: s.hidratacao.id, professionalId: s.bia.id }], fitIn }), s.recepcao, bahia(15, 9, 10));

  it("dois serviços com parallel_ok true para a mesma cliente em profissionais diferentes: sem encaixe", async () => {
    await juntos();
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    const r = await hidratacaoComBia(p.contactId);
    expect((await apptsOf(r.visitId)).find((a) => a.serviceId === s.hidratacao.id)).toMatchObject({ fitIn: false, professionalId: s.bia.id });
  });

  it("'Ao mesmo tempo' com um serviço parallel_ok false: 'O serviço Escova não pode ser feito ao mesmo tempo que outro serviço.'", async () => {
    const [escova] = await db.insert(lists).values({ kind: "service", label: "Escova", durationMin: 40, priceCents: 5000, parallelOk: false }).returning();
    await db.insert(professionalServices).values([s.ana, s.bia].map((p) => ({ professionalId: p.id, serviceId: escova.id })));
    const p = await cliente("Paula Souza");
    await expect(createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: escova.id, professionalId: s.bia.id, mode: "junto" }] }), s.recepcao, NOW))
      .rejects.toThrow("O serviço Escova não pode ser feito ao mesmo tempo que outro serviço.");
    await expect(createVisit(book(p.contactId, { items: [{ serviceId: escova.id, professionalId: s.ana.id }, { serviceId: s.corte.id, professionalId: s.bia.id, mode: "junto" }] }), s.recepcao, NOW))
      .rejects.toThrow("O serviço Escova não pode ser feito ao mesmo tempo que outro serviço.");
    // "Logo depois" continua valendo.
    await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: escova.id, professionalId: s.bia.id, mode: "depois" }] }), s.recepcao, NOW);
  });

  it("parallel_ok null: como hoje (conflito de cliente vira encaixe)", async () => {
    await updateService(s.corte.id, { parallelOk: true }, s.gestora.id); // só um lado: ainda conflita
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(hidratacaoComBia(p.contactId)).rejects.toThrow("Paula já tem Corte às 10:00 com a Ana");
    const r = await hidratacaoComBia(p.contactId, true);
    expect((await apptsOf(r.visitId)).find((a) => a.serviceId === s.hidratacao.id)).toMatchObject({ fitIn: true });
  });

  it("a mesma profissional nunca faz dois ao mesmo tempo, mesmo com parallel_ok", async () => {
    await juntos();
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(createVisit(book(q.contactId, { startsAt: at(10, 30), items: [{ serviceId: s.hidratacao.id, professionalId: s.ana.id }] }), s.recepcao, bahia(15, 9, 10)))
      .rejects.toThrow("Ana já tem Paula das 10:00 às 11:00");
  });

  it("função 'Serviço junto com outro' desligada: parallel_ok é ignorado (encaixe e 'ao mesmo tempo' como hoje) e gravar é recusado", async () => {
    await juntos();
    const [escova] = await db.insert(lists).values({ kind: "service", label: "Escova", durationMin: 40, priceCents: 5000, parallelOk: false }).returning();
    await db.insert(professionalServices).values([s.ana, s.bia].map((p) => ({ professionalId: p.id, serviceId: escova.id })));
    await saveFuncoes({ junto_com_outro: false }, s.gestora.id);
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(hidratacaoComBia(p.contactId)).rejects.toThrow("Paula já tem Corte às 10:00 com a Ana");
    const q = await cliente("Joana Lima");
    await createVisit(book(q.contactId, { startsAt: at(14), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: escova.id, professionalId: s.bia.id, mode: "junto" }] }), s.recepcao, NOW);
    await expect(updateService(s.corte.id, { parallelOk: false }, s.gestora.id)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
  });
});

describe("serviço: custo e preço 'a partir de'", () => {
  it("grava custo, tipo de preço e 'junto com outro'; recusa valores fora", async () => {
    await updateService(s.corte.id, { costCents: 4321, priceKind: "a_partir_de", parallelOk: true }, s.gestora.id);
    expect((await db.select().from(lists).where(eq(lists.id, s.corte.id)))[0]).toMatchObject({ costCents: 4321, priceKind: "a_partir_de", parallelOk: true });
    await updateService(s.corte.id, { costCents: null, priceKind: null, parallelOk: null }, s.gestora.id);
    expect((await db.select().from(lists).where(eq(lists.id, s.corte.id)))[0]).toMatchObject({ costCents: null, priceKind: null, parallelOk: null });
    await expect(updateService(s.corte.id, { costCents: -5 }, s.gestora.id)).rejects.toThrow("Confira o custo: use um valor como 40,00.");
    await expect(updateService(s.corte.id, { priceKind: "barato" as never }, s.gestora.id)).rejects.toThrow("Escolha como o preço aparece: Fixo, A partir de ou Sob consulta.");
    const { id } = await createService({ label: "Luzes", priceCents: 50000, priceKind: "sob_consulta", costCents: 10000 }, s.gestora.id);
    expect((await db.select().from(lists).where(eq(lists.id, id)))[0]).toMatchObject({ costCents: 10000, priceKind: "sob_consulta" });
  });

  it("o custo só vem na lista da aba para quem pode ver (withCost)", async () => {
    await updateService(s.corte.id, { costCents: 4321 }, s.gestora.id);
    const sem = (await listServicesPage()).services.find((x) => x.id === s.corte.id)!;
    expect("costCents" in sem).toBe(false);
    expect(JSON.stringify(sem)).not.toContain("4321");
    const com = (await listServicesPage({ withCost: true })).services.find((x) => x.id === s.corte.id)!;
    expect(com.costCents).toBe(4321);
  });

  it("custo do serviço nunca vai para a IA nem para /agendar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await updateService(s.corte.id, { costCents: 4321, priceKind: "a_partir_de" }, s.gestora.id);
    await db.insert(settings).values({ key: "agendamento_online", value: { enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [s.corte.id], profissionais: [s.ana.id] } });
    const casa = await loadCasaData();
    const system = buildSystem(casa);
    expect(JSON.stringify(casa)).not.toMatch(/4321|cost/i);
    expect(system).not.toContain("43,21");
    // O preço que a IA cita sai com o tipo: "a partir de".
    expect(system).toContain("Corte a partir de R$ 120,00");
    const online = await onlineOptions(NOW);
    expect(online).not.toBeNull();
    expect(JSON.stringify(online)).not.toMatch(/4321|cost/i);
    expect(online!.services.find((x) => x.id === s.corte.id)).toMatchObject({ priceText: "a partir de R$ 120,00" });
  });

  it("o custo não vai na conversa nem nas folhas de agendar e fechar venda (a equipe vê a lista de serviços)", async () => {
    await updateService(s.corte.id, { costCents: 4321 }, s.gestora.id);
    const p = await cliente("Paula Souza", { stage: "atendimento" });
    const sheet = await getDealSheetData(p.dealId!);
    const detail = await getDealDetail(p.dealId!);
    expect(sheet!.services.find((x) => x.id === s.corte.id)).toMatchObject({ label: "Corte", priceCents: 12000 });
    expect(JSON.stringify(sheet!.services)).not.toMatch(/4321|cost/i);
    expect(JSON.stringify(detail!.services)).not.toMatch(/4321|cost/i);
  });
});
