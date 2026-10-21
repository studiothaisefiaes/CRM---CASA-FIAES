import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, appointments, auditLog, contacts, deals, lists, professionals, professionalServices, stages, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, CASA_TER_SAB, cliente, NOW, setAgendaMode, setSetting, setupAgenda } from "../../../../test/agenda-fixtures";
import { createVisit, ExistingAppointmentError, rescheduleAppointment, type CreateVisitInput } from "./visits";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

const at10 = bahia(16, 10).toISOString();
const book = (contactId: string, over: Partial<CreateVisitInput> = {}): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: at10, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], ...over,
});
const apptsOf = (visitId: string) => db.select().from(appointments).where(eq(appointments.visitId, visitId)).orderBy(asc(appointments.startsAt), asc(appointments.professionalId));
const stageOf = async (dealId: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].k;

describe("marcar", () => {
  it("1 serviço: visita do dia, horário do CRM com preço e duração copiados do serviço, e auditoria", async () => {
    const p = await cliente();
    const r = await createVisit(book(p.contactId, { notes: "trazer foto" }), s.recepcao, NOW);
    expect(r).toMatchObject({ day: "2026-10-16", reused: false });
    expect((await db.select().from(visits).where(eq(visits.id, r.visitId)))[0]).toMatchObject({ contactId: p.contactId, day: "2026-10-16", origin: "crm", createdBy: s.cati.id });
    const [a] = await apptsOf(r.visitId);
    expect(a).toMatchObject({
      id: r.appointmentIds[0], externalKey: `crm:${r.appointmentIds[0]}`, origin: "crm", status: "agendado", professionalId: s.ana.id, serviceId: s.corte.id,
      serviceLabel: "Corte", durationMin: 60, priceCents: 12000, notes: "trazer foto", fitIn: false, outsideHours: false, anyPro: false, createdBy: s.cati.id,
    });
    expect(a.startsAt.toISOString()).toBe(at10);
    expect(a.crmTouchedAt).not.toBeNull();
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, a.id)))[0]).toMatchObject({ action: "agendamento_marcado", userId: s.cati.id });
  });

  it("2 serviços: 'logo depois' começa no fim do anterior; 'ao mesmo tempo' exige outra profissional", async () => {
    const p = await cliente();
    const r1 = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.ana.id, mode: "depois" }] }), s.recepcao, NOW);
    expect((await apptsOf(r1.visitId)).map((a) => a.startsAt.toISOString())).toEqual([bahia(16, 10), bahia(16, 11)].map((d) => d.toISOString()));
    const q = await cliente("Joana Lima");
    const at14 = bahia(16, 14).toISOString();
    const r2 = await createVisit(book(q.contactId, { startsAt: at14, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "junto" }] }), s.recepcao, NOW);
    expect((await apptsOf(r2.visitId)).map((a) => a.startsAt.toISOString())).toEqual([at14, at14]);
    await expect(createVisit(book(q.contactId, { startsAt: bahia(16, 16).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.ana.id, mode: "junto" }] }), s.recepcao, NOW))
      .rejects.toThrow("Ao mesmo tempo, as profissionais precisam ser diferentes.");
  });

  it("cliente nova: telefone já cadastrado reaproveita o contato (nunca duplica) e 'Não é cliente' volta a ser cliente", async () => {
    const p = await cliente("Paula Souza");
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, p.contactId));
    const r = await createVisit(book(p.contactId, { client: { name: "Outro Nome", phone: p.digits } }), s.recepcao, NOW);
    expect((await apptsOf(r.visitId))[0].contactId).toBe(p.contactId);
    expect((await db.select().from(contacts).where(eq(contacts.id, p.contactId)))[0]).toMatchObject({ ignored: false, name: "Paula Souza" });
    await expect(createVisit(book(p.contactId, { client: { name: "Sem Fone", phone: "123" } }), s.recepcao, NOW)).rejects.toThrow("Celular inválido. Use DDD + número, ex.: 71 99999-9999");
    await expect(createVisit(book(p.contactId, { client: { name: " ", phone: p.digits } }), s.recepcao, NOW)).rejects.toThrow("Escreva o nome da cliente.");
  });

  it("conflito com horário do CRM: sem 'Encaixar mesmo assim' (ou sem a permissão) recusa com o texto; com os dois, grava o encaixe", async () => {
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    const later = bahia(15, 9, 10); // 10 min depois: não é mais "acabou de ser ocupado"
    const outra = (fitIn?: boolean) => book(q.contactId, { startsAt: bahia(16, 10, 30).toISOString(), fitIn });
    await expect(createVisit(outra(), s.recepcao, later)).rejects.toThrow("Ana já tem Paula das 10:00 às 11:00");
    await expect(createVisit(outra(true), s.semEncaixe, later)).rejects.toThrow("Ana já tem Paula das 10:00 às 11:00");
    const r = await createVisit(outra(true), s.recepcao, later);
    expect((await apptsOf(r.visitId))[0]).toMatchObject({ fitIn: true, fitInBy: s.cati.id, outsideHours: false });
  });

  it("conflito com horário do Avec e com bloqueio", async () => {
    const p = await cliente("Paula Souza");
    await ap({ startsAt: bahia(16, 14), professionalId: s.ana.id, clientName: "Maria Avec" });
    await expect(createVisit(book(p.contactId, { startsAt: bahia(16, 14).toISOString() }), s.recepcao, NOW)).rejects.toThrow("Ana já tem Maria das 14:00 às 15:00");
    await db.insert(agendaBlocks).values({ professionalId: s.ana.id, title: "Almoço", startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "12:00", endTime: "13:00", externalKey: "crm:blq:teste", origin: "crm", reason: "almoco" });
    await expect(createVisit(book(p.contactId, { startsAt: bahia(16, 12, 30).toISOString(), fitIn: true }), s.recepcao, NOW)).rejects.toThrow(/bloqueada nesse horário/);
  });

  it("a mesma cliente com outra profissional no mesmo horário", async () => {
    const p = await cliente("Paula Souza");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(createVisit(book(p.contactId, { startsAt: bahia(16, 10, 30).toISOString(), items: [{ serviceId: s.hidratacao.id, professionalId: s.bia.id }] }), s.recepcao, bahia(15, 9, 10)))
      .rejects.toThrow("Paula já tem Corte às 10:00 com a Ana");
  });

  it("Review Focus 2: profissional sem horário próprio na segunda, com a Casa fechada: só com encaixe, e fica registrado", async () => {
    await setSetting("business_hours", CASA_TER_SAB);
    const [carla] = await db.insert(professionals).values({ name: "Carla" }).returning();
    await db.insert(professionalServices).values({ professionalId: carla.id, serviceId: s.corte.id });
    const p = await cliente();
    const seg = (fitIn?: boolean) => book(p.contactId, { startsAt: bahia(19, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: carla.id }], fitIn });
    await expect(createVisit(seg(), s.recepcao, NOW)).rejects.toThrow("Fora do horário de trabalho de Carla.");
    await expect(createVisit(seg(true), s.semEncaixe, NOW)).rejects.toThrow("Fora do horário de trabalho de Carla.");
    const r = await createVisit(seg(true), s.recepcao, NOW);
    expect((await apptsOf(r.visitId))[0]).toMatchObject({ outsideHours: true, fitIn: false });
  });

  it("Review Focus 3: 23:30 por 60 min é recusado, mesmo com encaixe", async () => {
    const p = await cliente();
    await expect(createVisit(book(p.contactId, { startsAt: bahia(16, 23, 30).toISOString(), fitIn: true }), s.recepcao, NOW)).rejects.toThrow("Esse horário passa da meia-noite");
  });

  it("serviço sem duração: pede a desta vez; com ela, marca; 'Salvar como duração do serviço' só com config.diaadia", async () => {
    const p = await cliente();
    const mechas = (d?: number, save?: boolean, startsAt = at10) => book(p.contactId, { startsAt, items: [{ serviceId: s.mechas.id, professionalId: s.ana.id, durationMin: d, saveDuration: save }] });
    await expect(createVisit(mechas(), s.recepcao, NOW)).rejects.toThrow("Mechas não tem duração cadastrada. Diga quanto tempo leva desta vez.");
    await expect(createVisit(mechas(97), s.recepcao, NOW)).rejects.toThrow("Confira a duração: de 5 em 5 minutos, até 12 horas.");
    // Lote 4: quem configura o dia a dia (serviços) salva a duração; sem config.diaadia, marca só desta vez.
    const semDiaADia = { ...s.recepcao, perms: s.recepcao.perms.filter((x) => x !== "config.diaadia") };
    const r = await createVisit(mechas(90, true), semDiaADia, NOW);
    expect((await apptsOf(r.visitId))[0].durationMin).toBe(90);
    expect((await db.select().from(lists).where(eq(lists.id, s.mechas.id)))[0].durationMin).toBeNull();
    await createVisit(mechas(120, true, bahia(16, 14).toISOString()), s.gestao, NOW);
    expect((await db.select().from(lists).where(eq(lists.id, s.mechas.id)))[0].durationMin).toBe(120);
  });

  it("a profissional precisa fazer o serviço; com config.diaadia dá para marcar 'Ela faz esse serviço' ali mesmo", async () => {
    const p = await cliente();
    await db.delete(professionalServices).where(and(eq(professionalServices.professionalId, s.ana.id), eq(professionalServices.serviceId, s.hidratacao.id)));
    const item = () => book(p.contactId, { items: [{ serviceId: s.hidratacao.id, professionalId: s.ana.id, linkService: true }] });
    const semDiaADia = { ...s.recepcao, perms: s.recepcao.perms.filter((x) => x !== "config.diaadia") };
    await expect(createVisit(item(), semDiaADia, NOW)).rejects.toThrow("Ana não faz esse serviço.");
    await createVisit(item(), s.recepcao, NOW); // Lote 4: a recepção configura o dia a dia (profissionais e serviços)
    expect(await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, s.ana.id), eq(professionalServices.serviceId, s.hidratacao.id)))).toHaveLength(1);
  });

  it("Qualquer uma: a livre com menos horários no dia; empate pela ordem da agenda", async () => {
    const [p, q, r0] = [await cliente(), await cliente("Joana Lima"), await cliente("Rita Melo")];
    const any = (contactId: string, h: number) => book(contactId, { startsAt: bahia(16, h).toISOString(), items: [{ serviceId: s.corte.id, professionalId: null }] });
    const r1 = await createVisit(any(p.contactId, 10), s.recepcao, NOW);
    expect((await apptsOf(r1.visitId))[0]).toMatchObject({ professionalId: s.ana.id, anyPro: true });
    const r2 = await createVisit(any(q.contactId, 14), s.recepcao, NOW);
    expect((await apptsOf(r2.visitId))[0].professionalId).toBe(s.bia.id);
    const r3 = await createVisit(any(r0.contactId, 10), s.recepcao, bahia(15, 9, 10));
    expect((await apptsOf(r3.visitId))[0].professionalId).toBe(s.bia.id);
  });

  it("Encaixe agora: a cliente chegou sem hora e o horário nasce como Chegou", async () => {
    const p = await cliente();
    const now = bahia(16, 10, 5);
    const r = await createVisit(book(p.contactId, { walkIn: true }), s.recepcao, now);
    const [a] = await apptsOf(r.visitId);
    expect(a.status).toBe("chegou");
    expect(a.arrivedAt?.toISOString()).toBe(now.toISOString());
  });

  it("o mesmo horário que já veio do Avec: não cria outro e aponta o que existe", async () => {
    const p = await cliente("Paula Souza");
    const avec = await ap({ startsAt: bahia(16, 10), contactId: p.contactId, serviceId: s.corte.id, professionalId: s.bia.id });
    const e = await createVisit(book(p.contactId), s.recepcao, NOW).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ExistingAppointmentError);
    expect(e).toMatchObject({ message: "Paula já tem Corte às 10:00 (veio do Avec). Abrir o horário", appointmentId: avec.id, day: "2026-10-16" });
    expect(await db.select().from(visits)).toHaveLength(0);
  });

  it("modo consulta recusa marcar", async () => {
    await setAgendaMode("consulta");
    const p = await cliente();
    await expect(createVisit(book(p.contactId), s.recepcao, NOW)).rejects.toThrow("A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda.");
  });
});

describe("Review Focus 4: dois cliques ao mesmo tempo", () => {
  it("duas transações para a Ana às 10:00: uma passa, a outra recebe 'acabou de ser ocupado'", async () => {
    const p = await cliente("Paula Souza"), q = await cliente("Vera Henriques");
    const rs = await Promise.allSettled([createVisit(book(p.contactId), s.recepcao, NOW), createVisit(book(q.contactId), s.recepcao, NOW)]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const fail = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(fail.reason.message).toBe("Esse horário acabou de ser ocupado (Cati marcou Paula às 09:00). Escolha outro.");
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("o mesmo formulário enviado duas vezes (mesma request_key) cria uma visita só", async () => {
    const p = await cliente();
    const input = book(p.contactId);
    const [a, b] = await Promise.all([createVisit(input, s.recepcao, NOW), createVisit(input, s.recepcao, NOW)]);
    expect(a.visitId).toBe(b.visitId);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(await db.select().from(visits)).toHaveLength(1);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });
});

describe("funil (1C)", () => {
  it("marcar de dentro da conversa grava visits.deal_id e leva a Agendado", async () => {
    const p = await cliente("Paula Souza", { conversaHaDias: 1, stage: "atendimento" });
    const r = await createVisit(book(p.contactId, { dealId: p.dealId }), s.recepcao, NOW);
    expect((await db.select().from(visits).where(eq(visits.id, r.visitId)))[0].dealId).toBe(p.dealId);
    expect(await stageOf(p.dealId!)).toBe("agendado");
  });
  it("decisão 4: sem conversa nos últimos 30 dias, marcar não cria cartão", async () => {
    const p = await cliente("Joana Lima", { conversaHaDias: 40 });
    await createVisit(book(p.contactId), s.recepcao, NOW);
    expect(await db.select().from(deals).where(eq(deals.contactId, p.contactId))).toHaveLength(0);
  });
});

describe("preferência pela profissional (6.11)", () => {
  it("'Tanto faz' sem profissional: o sistema escolhe a livre e grava sem_preferencia; 'Pediu ela' sem profissional é recusado", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit({ ...book(p.contactId), items: [{ serviceId: s.corte.id, professionalId: null, preference: "sem_preferencia" }] }, s.recepcao, NOW);
    const [a] = await db.select().from(appointments).where(eq(appointments.id, r.appointmentIds[0]));
    expect(a).toMatchObject({ preference: "sem_preferencia", anyPro: true });
    expect(a.professionalId).not.toBeNull();
    await expect(createVisit({ ...book(p.contactId), requestKey: randomUUID(), startsAt: bahia(16, 14).toISOString(), items: [{ serviceId: s.corte.id, professionalId: null, preference: "escolhida" }] }, s.recepcao, NOW))
      .rejects.toThrow("Escolha a profissional que ela pediu.");
  });

  it("remarcar para outra profissional quando ela pediu a Ana exige confirmar; 'tanto faz' troca sem perguntar", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit({ ...book(p.contactId), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, NOW);
    const id = r.appointmentIds[0];
    await expect(rescheduleAppointment(id, { startsAt: bahia(16, 15).toISOString(), professionalId: s.bia.id }, s.recepcao, NOW))
      .rejects.toThrow("Ela pediu a Ana. Confirme a troca de profissional.");
    await rescheduleAppointment(id, { startsAt: bahia(16, 15).toISOString(), professionalId: s.bia.id, confirmProChange: true }, s.recepcao, NOW);
    expect((await db.select().from(appointments).where(eq(appointments.id, id)))[0]).toMatchObject({ professionalId: s.bia.id, preference: "escolhida" });
    const q = await cliente("Rita Lima");
    const r2 = await createVisit({ ...book(q.contactId), requestKey: randomUUID(), startsAt: bahia(17, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "sem_preferencia" }] }, s.recepcao, NOW);
    await expect(rescheduleAppointment(r2.appointmentIds[0], { startsAt: bahia(17, 10).toISOString(), professionalId: s.bia.id }, s.recepcao, NOW)).resolves.toBeTruthy();
  });

  it("sem informar (como a importação e a migração): fica null", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    expect((await db.select().from(appointments).where(eq(appointments.id, r.appointmentIds[0])))[0].preference).toBeNull();
  });
});

describe("Marcar na visita que a cliente já tem no dia (17/10: cada Marcar criava outra visita e outro lembrete)", () => {
  it("o segundo Marcar do mesmo dia entra na mesma visita; reenviar o mesmo formulário continua devolvendo os mesmos horários", async () => {
    const p = await cliente("Paula Souza");
    const r1 = await createVisit(book(p.contactId), s.recepcao, NOW);
    const second = book(p.contactId, { startsAt: bahia(16, 14).toISOString(), items: [{ serviceId: s.hidratacao.id, professionalId: s.bia.id }] });
    const r2 = await createVisit(second, s.recepcao, NOW);
    expect(r2.visitId).toBe(r1.visitId);
    expect(r2.reused).toBe(false);
    const again = await createVisit(second, s.recepcao, NOW);
    expect(again).toMatchObject({ visitId: r1.visitId, appointmentIds: r2.appointmentIds, reused: true });
    expect(await db.select().from(visits).where(eq(visits.contactId, p.contactId))).toHaveLength(1);
  });
});

